import type { API, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import type { AccessoryHandler, DiscoveredDevice } from '@mm/hb-core';
import { BasePlatform, errorMessage, numberOption, prefixed } from '@mm/hb-core';
import { ModernFormsApi } from './mf-api.js';
import type { MfInfo } from './mf-api.js';
import { ModernFormsFan } from './fan.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import type { ModernFormsPlatformConfig } from './settings.js';

export interface MfContext {
  host: string;
  info: MfInfo;
  nameOverride?: string;
}

export class ModernFormsPlatform extends BasePlatform<MfContext> {
  readonly pollIntervalMs: number;
  readonly breezeAsSwingMode: boolean;
  private readonly cfg: ModernFormsPlatformConfig;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    const cfg = config as PlatformConfig & ModernFormsPlatformConfig;
    super(log, config, api, { pluginName: PLUGIN_NAME, platformName: PLATFORM_NAME, removeStale: cfg.removeStale ?? true });
    this.cfg = cfg;
    this.pollIntervalMs = numberOption(cfg.pollIntervalSec, 15, 3, 3600) * 1000;
    this.breezeAsSwingMode = Boolean(cfg.breezeAsSwingMode);
  }

  protected async discover(): Promise<Array<DiscoveredDevice<MfContext>>> {
    const fans = (this.cfg.fans ?? []).filter((f) => f && f.host);
    if (fans.length === 0) throw new Error('No fans configured (need at least one host)');
    const found: Array<DiscoveredDevice<MfContext>> = [];
    for (const f of fans) {
      try {
        const info = await new ModernFormsApi(f.host).getInfo();
        if (!info.clientId) throw new Error('reply had no clientId');
        const displayName = f.name?.trim() || info.deviceName || `Fan ${f.host}`;
        this.log.info(`Fan "${displayName}" at ${f.host}: ${info.fanType} fw ${info.firmwareVersion || '?'} (${info.clientId})`);
        found.push({
          uniqueId: info.clientId,
          displayName,
          category: this.api.hap.Categories.FAN,
          context: { host: f.host, info, nameOverride: f.name },
        });
      } catch (err) {
        this.log.error(`Fan at ${f.host} unreachable: ${errorMessage(err)}`);
        // Keep a cached accessory alive if we have one for this host.
        const cached = [...this.cached.values()].find((a) => (a.context.device as MfContext | undefined)?.host === f.host);
        if (cached) {
          const ctx = cached.context.device as MfContext;
          found.push({ uniqueId: String(cached.context.uniqueId), displayName: cached.displayName, context: ctx });
        }
      }
    }
    if (found.length === 0) throw new Error('No fan answered; leaving cached accessories in place');
    return found;
  }

  protected createHandler(accessory: PlatformAccessory, d: DiscoveredDevice<MfContext>): AccessoryHandler {
    return new ModernFormsFan(
      {
        api: this.api,
        log: prefixed(this.log, d.displayName),
        client: new ModernFormsApi(d.context.host),
        pollIntervalMs: this.pollIntervalMs,
        breezeAsSwingMode: this.breezeAsSwingMode,
      },
      accessory,
      d.context,
    );
  }
}
