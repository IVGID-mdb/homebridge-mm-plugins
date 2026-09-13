import type { API, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import type { AccessoryHandler, DiscoveredDevice } from '@mm/hb-core';
import { BasePlatform, numberOption, prefixed } from '@mm/hb-core';
import { LitterRobotAccessory } from './robot.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import type { LitterRobotPlatformConfig } from './settings.js';
import { WhiskerApi } from './whisker-api.js';
import type { RobotData } from './whisker-api.js';

export interface RobotContext {
  serial: string;
  unitId: string;
  name: string;
  last: RobotData;
}

export class LitterRobotPlatform extends BasePlatform<RobotContext> {
  readonly cfg: LitterRobotPlatformConfig;
  readonly whisker: WhiskerApi | undefined;
  private readonly pollMs: number;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    const cfg = config as PlatformConfig & LitterRobotPlatformConfig;
    super(log, config, api, { pluginName: PLUGIN_NAME, platformName: PLATFORM_NAME, removeStale: cfg.removeStale ?? true });
    this.cfg = cfg;
    this.pollMs = numberOption(cfg.pollIntervalSec, 60, 15, 3600) * 1000;
    if (cfg.username && cfg.password) {
      this.whisker = new WhiskerApi(cfg.username, cfg.password, {
        cognitoUrl: cfg.cognitoUrl,
        graphqlUrl: cfg.graphqlUrl,
        log: prefixed(log, 'whisker'),
      });
    } else {
      log.error('Whisker username and password are required');
    }
  }

  protected async discover(): Promise<Array<DiscoveredDevice<RobotContext>>> {
    if (!this.whisker) throw new Error('not configured');
    const robots = await this.whisker.listRobots();
    const onboarded = robots.filter((r) => r.isOnboarded !== false);
    this.log.info(`Whisker account has ${onboarded.length} Litter-Robot 4 unit(s)`);
    return onboarded.map((r) => ({
      uniqueId: r.serial,
      displayName: r.name || `Litter-Robot ${r.serial}`,
      context: { serial: r.serial, unitId: r.unitId, name: r.name, last: r },
    }));
  }

  protected createHandler(accessory: PlatformAccessory, d: DiscoveredDevice<RobotContext>): AccessoryHandler {
    if (!this.whisker) throw new Error('not configured');
    return new LitterRobotAccessory(
      {
        api: this.api,
        log: prefixed(this.log, d.displayName),
        whisker: this.whisker,
        pollIntervalMs: this.pollMs,
        exposeDrawerAlert: this.cfg.exposeDrawerAlert ?? true,
        exposeResetSwitch: this.cfg.exposeResetSwitch ?? true,
        exposeCleanCycle: this.cfg.exposeCleanCycle ?? true,
        alertWhenPoweredOff: this.cfg.alertWhenPoweredOff ?? true,
        attentionDebounceMs: numberOption(this.cfg.attentionDebounceMinutes, 15, 0, 240) * 60_000,
        litterLowPercent: numberOption(this.cfg.litterLowPercent, 15, 0, 100),
        staleMs: numberOption(this.cfg.staleMinutes, 60, 5, 1440) * 60_000,
      },
      accessory,
      d.context.last,
    );
  }
}
