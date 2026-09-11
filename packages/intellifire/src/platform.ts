import type { API, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import type { AccessoryHandler, DiscoveredDevice } from '@mm/hb-core';
import { BasePlatform, errorMessage, numberOption, prefixed } from '@mm/hb-core';
import { IntellifireCloud } from './cloud-api.js';
import { discoverFireplaces } from './discovery.js';
import { FireplaceAccessory } from './fireplace.js';
import { IntellifireLocal } from './local-api.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import type { IntellifirePlatformConfig } from './settings.js';
import { parseFireplaceState } from './state.js';
import type { FireplaceState } from './state.js';
import { AutoTransport, CloudTransport, LocalTransport } from './transport.js';
import type { FireplaceTransport } from './transport.js';

/** Persisted in accessory.context so the plugin works offline after the first cloud login. */
export interface FireplaceContext {
  serial: string;
  apikey: string;
  name: string;
  brand: string;
  ip?: string;
  userId?: string;
  lastState?: FireplaceState;
}

export class IntellifirePlatform extends BasePlatform<FireplaceContext> {
  readonly cfg: IntellifirePlatformConfig;
  readonly cloud: IntellifireCloud;
  private readonly localPollMs: number;
  private readonly cloudPollMs: number;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    const cfg = config as PlatformConfig & IntellifirePlatformConfig;
    super(log, config, api, { pluginName: PLUGIN_NAME, platformName: PLATFORM_NAME, removeStale: cfg.removeStale ?? true });
    this.cfg = cfg;
    this.cloud = new IntellifireCloud(cfg.cloudBaseUrl);
    if (cfg.user && cfg.auth_cookie && cfg.web_client_id) {
      this.cloud.setCookies({ user: cfg.user, auth_cookie: cfg.auth_cookie, web_client_id: cfg.web_client_id });
    }
    this.localPollMs = numberOption(cfg.localPollIntervalSec, 5, 2, 300) * 1000;
    this.cloudPollMs = numberOption(cfg.cloudPollIntervalSec, 60, 15, 3600) * 1000;
  }

  get mode(): 'auto' | 'local' | 'cloud' {
    return this.cfg.mode === 'local' || this.cfg.mode === 'cloud' ? this.cfg.mode : 'auto';
  }

  protected async discover(): Promise<Array<DiscoveredDevice<FireplaceContext>>> {
    const overrides = this.cfg.fireplaces ?? [];
    const known = new Map<string, FireplaceContext>();
    for (const a of this.cached.values()) {
      const ctx = a.context.device as FireplaceContext | undefined;
      if (ctx?.serial) known.set(ctx.serial, { ...ctx });
    }

    // 1. Cloud: log in (or reuse cookies) and enumerate fireplaces → serial + apikey.
    let cloudOk = false;
    try {
      await this.ensureCloudSession();
      if (this.cloud.hasSession) {
        const list = await this.cloud.listFireplaces();
        cloudOk = true;
        this.log.info(`IntelliFire account has ${list.length} fireplace(s)`);
        for (const f of list) {
          const prev = known.get(f.serial);
          known.set(f.serial, {
            ...prev,
            serial: f.serial,
            apikey: f.apikey || prev?.apikey || '',
            name: f.name || prev?.name || f.serial,
            brand: f.brand || prev?.brand || 'IntelliFire',
            userId: this.cloud.userId ?? prev?.userId,
          });
        }
        if (this.cfg.removeStale ?? true) {
          for (const serial of [...known.keys()]) {
            if (!list.some((f) => f.serial === serial)) known.delete(serial);
          }
        }
      }
    } catch (err) {
      this.log.warn(`IntelliFire cloud unavailable (${errorMessage(err)}); using cached fireplaces`);
    }
    if (known.size === 0) {
      throw new Error(cloudOk ? 'No fireplaces on this IntelliFire account' : 'No cloud session and no cached fireplaces');
    }

    // 2. Local addresses: config override → LAN discovery → last known.
    if (this.mode !== 'cloud') {
      const discovered = await discoverFireplaces({
        port: this.cfg.discoveryPort,
        listenPort: this.cfg.discoveryListenPort,
        timeoutMs: this.cfg.discoveryTimeoutMs,
        log: this.log,
      }).catch((err) => {
        this.log.debug(`LAN discovery failed: ${errorMessage(err)}`);
        return [];
      });
      for (const d of discovered) {
        const ctx = known.get(d.serial);
        if (ctx) ctx.ip = d.ip;
        else this.log.info(`Found fireplace ${d.serial} at ${d.ip} that is not on the account; ignoring`);
      }
      for (const o of overrides) {
        if (o.serial && o.ip && known.has(o.serial)) known.get(o.serial)!.ip = o.ip;
      }
      // Single fireplace + single override without serial: apply the override to it.
      if (known.size === 1 && overrides.length === 1 && !overrides[0]!.serial && overrides[0]!.ip) {
        [...known.values()][0]!.ip = overrides[0]!.ip;
      }
    }

    // 3. First poll now, so the accessory knows which optional services (blower, light,
    //    thermostat) to create before HomeKit sees it.
    for (const ctx of known.values()) {
      const fresh = await this.primeState(ctx);
      if (fresh) ctx.lastState = fresh;
    }

    return [...known.values()].map((ctx) => {
      const o = overrides.find((x) => x.serial === ctx.serial) ?? (known.size === 1 ? overrides[0] : undefined);
      return {
        uniqueId: ctx.serial,
        displayName: o?.name?.trim() || ctx.name,
        category: this.api.hap.Categories.AIR_HEATER,
        context: ctx,
      };
    });
  }

  protected createHandler(accessory: PlatformAccessory, d: DiscoveredDevice<FireplaceContext>): AccessoryHandler {
    const ctx = d.context;
    const log = prefixed(this.log, d.displayName);
    const transport = this.transportFor(ctx, log);
    log.info(`control path: ${transport.name}${ctx.ip ? ` (ip ${ctx.ip})` : ''}`);
    const handler = new FireplaceAccessory(
      {
        api: this.api,
        log,
        transport,
        pollIntervalMs: transport.name === 'cloud' ? this.cloudPollMs : this.localPollMs,
        exposeSwitch: Boolean(this.cfg.exposeSwitch),
        exposeBlower: this.cfg.exposeBlower ?? true,
        exposeLight: this.cfg.exposeLight ?? true,
      },
      accessory,
      { serial: ctx.serial, name: ctx.name, brand: ctx.brand },
      ctx.lastState,
    );
    // Persist the latest state so features (blower/light/thermostat) are known on next boot.
    const persist = setInterval(() => {
      const s = handler.lastState;
      if (s && JSON.stringify(s) !== JSON.stringify(ctx.lastState)) {
        ctx.lastState = s;
        accessory.context.device = ctx;
        this.api.updatePlatformAccessories([accessory]);
      }
    }, 60_000);
    persist.unref?.();
    return {
      dispose: () => {
        clearInterval(persist);
        handler.dispose();
      },
    };
  }

  private transportFor(ctx: FireplaceContext, log: ReturnType<typeof prefixed>): FireplaceTransport {
    const local =
      ctx.ip && ctx.apikey && ctx.userId ? new LocalTransport(new IntellifireLocal(ctx.ip, ctx.apikey, ctx.userId)) : undefined;
    const cloud = this.cloud.hasSession ? new CloudTransport(this.cloud, ctx.serial) : undefined;
    if (this.mode === 'local') {
      if (!local) throw new Error(`local mode requested but no ip/apikey/user for ${ctx.serial}`);
      return local;
    }
    if (this.mode === 'cloud') {
      if (!cloud) throw new Error('cloud mode requested but no cloud session');
      return cloud;
    }
    if (local && cloud) return new AutoTransport(local, cloud, log);
    const only = local ?? cloud;
    if (!only) throw new Error(`no way to reach fireplace ${ctx.serial}`);
    return only;
  }

  private async ensureCloudSession(): Promise<void> {
    if (this.cloud.hasSession) return;
    if (this.cfg.username && this.cfg.password) {
      this.log.info('Logging in to IntelliFire cloud…');
      await this.cloud.login(this.cfg.username, this.cfg.password);
      return;
    }
    this.log.warn('No IntelliFire credentials configured (username/password or cookies)');
  }

  /** Learn the first poll's state for a freshly discovered fireplace (needed to size services). */
  async primeState(ctx: FireplaceContext): Promise<FireplaceState | undefined> {
    try {
      if (ctx.ip && ctx.apikey && ctx.userId && this.mode !== 'cloud') {
        return parseFireplaceState(await new IntellifireLocal(ctx.ip, ctx.apikey, ctx.userId).poll());
      }
      if (this.cloud.hasSession && this.mode !== 'local') {
        return parseFireplaceState(await this.cloud.poll(ctx.serial));
      }
    } catch (err) {
      this.log.debug(`prime poll failed for ${ctx.serial}: ${errorMessage(err)}`);
    }
    return undefined;
  }
}
