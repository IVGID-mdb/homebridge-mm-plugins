import type { API, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import type { AccessoryHandler, DiscoveredDevice } from '@mm/hb-core';
import { BasePlatform, errorMessage, numberOption, prefixed } from '@mm/hb-core';
import { BondApi } from './bond-api.js';
import type { BondDevice, BondDeviceState } from './bond-api.js';
import { BpupClient } from './bpup.js';
import type { BpupStateEvent } from './bpup.js';
import { BondCeilingFan } from './accessories/ceiling-fan.js';
import { BondLight } from './accessories/light.js';
import { BondSwitchDevice } from './accessories/switch-device.js';
import { BondShades } from './accessories/shades.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import type { BondPlatformConfig } from './settings.js';

export interface BondContext {
  bondId: string;
  host: string;
  device: BondDevice;
  firmware: string;
  make: string;
  model: string;
}

interface Bridge {
  api: BondApi;
  bondId: string;
  push: BpupClient | undefined;
  /** device id → handler that wants push state. */
  listeners: Map<string, (state: BondDeviceState) => void>;
}

export class BondPlatform extends BasePlatform<BondContext> {
  private readonly bridges = new Map<string, Bridge>();
  readonly pollIntervalMs: number;
  private readonly cfg: BondPlatformConfig;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    const cfg = config as PlatformConfig & BondPlatformConfig;
    super(log, config, api, { pluginName: PLUGIN_NAME, platformName: PLATFORM_NAME, removeStale: cfg.removeStale ?? true });
    this.cfg = cfg;
    this.pollIntervalMs = numberOption(cfg.pollIntervalSec, 60, 5, 3600) * 1000;
  }

  protected async discover(): Promise<Array<DiscoveredDevice<BondContext>>> {
    const bonds = (this.cfg.bonds ?? []).filter((b) => b && b.host && b.token);
    if (bonds.length === 0) {
      throw new Error('No Bond bridges configured (need host + token)');
    }
    const exclude = new Set((this.cfg.exclude ?? []).map(String));
    const found: Array<DiscoveredDevice<BondContext>> = [];
    let anyOk = false;
    for (const b of bonds) {
      try {
        const api = new BondApi(b.host, b.token);
        const version = await api.getVersion();
        anyOk = true;
        const bridge = this.bridgeFor(b.host, version.bondid, api);
        this.log.info(`Bond ${version.bondid} at ${b.host}: ${version.make ?? ''} ${version.model ?? ''} fw ${version.fw_ver}`);
        const ids = await api.getDeviceIds();
        for (const id of ids) {
          if (exclude.has(id)) {
            this.log.info(`Skipping excluded device ${id}`);
            continue;
          }
          try {
            const device = await api.getDevice(id);
            const location = device.info.location?.trim();
            const displayName = location ? `${location} ${device.info.name}` : device.info.name;
            found.push({
              uniqueId: `${version.bondid}:${id}`,
              displayName,
              category: categoryFor(device.info.type, this.api),
              context: {
                bondId: bridge.bondId,
                host: b.host,
                device,
                firmware: version.fw_ver,
                make: version.make ?? 'Olibra',
                model: version.model ?? 'Bond',
              },
            });
          } catch (err) {
            this.log.warn(`Bond ${version.bondid}: could not read device ${id}: ${errorMessage(err)}`);
          }
        }
      } catch (err) {
        this.log.error(`Bond at ${b.host} unreachable: ${errorMessage(err)}`);
      }
    }
    if (!anyOk) {
      throw new Error('No Bond bridge answered; leaving cached accessories in place');
    }
    return found;
  }

  protected createHandler(accessory: PlatformAccessory, d: DiscoveredDevice<BondContext>): AccessoryHandler {
    const ctx = d.context;
    const bridge = this.bridgeFor(ctx.host, ctx.bondId, new BondApi(ctx.host, this.tokenFor(ctx.host)));
    const log = prefixed(this.log, d.displayName);
    const deps = {
      api: this.api,
      log,
      bond: bridge.api,
      pollIntervalMs: this.pollIntervalMs,
      subscribe: (cb: (s: BondDeviceState) => void) => {
        bridge.listeners.set(ctx.device.id, cb);
        return () => bridge.listeners.delete(ctx.device.id);
      },
    };
    switch (ctx.device.info.type) {
      case 'CF':
        return new BondCeilingFan(deps, accessory, ctx);
      case 'LT':
        return new BondLight(deps, accessory, ctx);
      case 'MS':
        return new BondShades(deps, accessory, ctx);
      case 'FP':
      case 'GX':
      default:
        return new BondSwitchDevice(deps, accessory, ctx);
    }
  }

  protected override onShutdown(): void {
    for (const b of this.bridges.values()) b.push?.stop();
    this.bridges.clear();
  }

  private tokenFor(host: string): string {
    return (this.cfg.bonds ?? []).find((b) => b.host === host)?.token ?? '';
  }

  private bridgeFor(host: string, bondId: string, api: BondApi): Bridge {
    let bridge = this.bridges.get(host);
    if (bridge) return bridge;
    bridge = { api, bondId, push: undefined, listeners: new Map() };
    if (this.cfg.push ?? true) {
      // BPUP talks to the bridge's IP; strip any :port used for the HTTP side (tests / proxies).
      const udpHost = host.replace(/:\d+$/, '');
      const push = new BpupClient(udpHost, prefixed(this.log, `Bond ${bondId}`), this.cfg.pushPort);
      push.on('state', (ev: BpupStateEvent) => {
        const cb = bridge!.listeners.get(ev.deviceId);
        if (cb) cb(ev.state as BondDeviceState);
      });
      push.start();
      bridge.push = push;
    }
    this.bridges.set(host, bridge);
    return bridge;
  }
}

function categoryFor(type: string, api: API): number {
  switch (type) {
    case 'CF':
      return api.hap.Categories.FAN;
    case 'LT':
      return api.hap.Categories.LIGHTBULB;
    case 'MS':
      return api.hap.Categories.WINDOW_COVERING;
    default:
      return api.hap.Categories.SWITCH;
  }
}
