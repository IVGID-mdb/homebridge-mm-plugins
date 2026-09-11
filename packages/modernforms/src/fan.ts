import type { API, PlatformAccessory, Service } from 'homebridge';
import type { AccessoryHandler, Log } from '@mm/hb-core';
import {
  Poller,
  WriteCoalescer,
  commFailure,
  ensureService,
  errorMessage,
  levelToPercent,
  percentToLevel,
  pruneServices,
  setAccessoryInfo,
  snapPercent,
} from '@mm/hb-core';
import { MF_SPEED_LEVELS } from './mf-api.js';
import type { MfSet, MfState, ModernFormsApi } from './mf-api.js';
import type { MfContext } from './platform.js';

export interface FanDeps {
  api: API;
  log: Log;
  client: ModernFormsApi;
  pollIntervalMs: number;
  breezeAsSwingMode: boolean;
}

interface FanWrite {
  active: number;
  speed: number;
}

/**
 * Modern Forms fan → HomeKit Fanv2 + Lightbulb.
 *
 *  Fanv2.Active            ← fanOn                        → {fanOn}
 *  Fanv2.RotationSpeed     ← fanSpeed/6 (0 when off)      → {fanOn:true, fanSpeed:1..6}; 0 % → {fanOn:false}
 *  Fanv2.RotationDirection ← forward=CLOCKWISE, reverse=COUNTER_CLOCKWISE → {fanDirection}
 *  Fanv2.SwingMode         ← wind (optional, "breeze")    → {wind}
 *  Lightbulb.On            ← lightOn                      → {lightOn}
 *  Lightbulb.Brightness    ← lightBrightness 1..100       → {lightOn:true, lightBrightness}; 0 → {lightOn:false}
 *
 * Every set returns the fan's full state, which is applied immediately, so HomeKit never waits
 * for the next poll to catch up.
 */
export class ModernFormsFan implements AccessoryHandler {
  private readonly fan: Service;
  private readonly light: Service | undefined;
  private readonly poller: Poller;
  private readonly writes: WriteCoalescer<FanWrite>;
  private state: MfState | undefined;

  constructor(
    private readonly deps: FanDeps,
    private readonly accessory: PlatformAccessory,
    ctx: MfContext,
  ) {
    const { Service: S, Characteristic: C } = deps.api.hap;
    setAccessoryInfo(deps.api, accessory, {
      manufacturer: 'Modern Forms',
      model: ctx.info.fanType || 'Smart Fan',
      serialNumber: ctx.info.mac || ctx.info.clientId,
      firmwareRevision: ctx.info.firmwareVersion,
    });
    const keep = new Set<Service>();

    this.fan = ensureService(deps.api, accessory, S.Fanv2, accessory.displayName);
    keep.add(this.fan);
    this.writes = new WriteCoalescer<FanWrite>((ch) => this.applyFanWrite(ch));

    this.fan
      .getCharacteristic(C.Active)
      .onGet(() => (this.current().fanOn ? C.Active.ACTIVE : C.Active.INACTIVE))
      .onSet((v) => this.writes.write('active', Number(v)));

    this.fan
      .getCharacteristic(C.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(() => this.speedPercent(this.current()))
      .onSet((v) => this.writes.write('speed', Number(v)));

    this.fan
      .getCharacteristic(C.RotationDirection)
      .onGet(() =>
        this.current().fanDirection === 'reverse' ? C.RotationDirection.COUNTER_CLOCKWISE : C.RotationDirection.CLOCKWISE,
      )
      .onSet((v) =>
        this.set({ fanDirection: Number(v) === C.RotationDirection.COUNTER_CLOCKWISE ? 'reverse' : 'forward' }),
      );

    if (deps.breezeAsSwingMode) {
      this.fan
        .getCharacteristic(C.SwingMode)
        .onGet(() => (this.current().wind ? C.SwingMode.SWING_ENABLED : C.SwingMode.SWING_DISABLED))
        .onSet((v) => this.set({ wind: Number(v) === C.SwingMode.SWING_ENABLED }));
    } else if (this.fan.testCharacteristic(C.SwingMode)) {
      this.fan.removeCharacteristic(this.fan.getCharacteristic(C.SwingMode));
    }

    if (ctx.info.hasLight) {
      this.light = ensureService(deps.api, accessory, S.Lightbulb, `${accessory.displayName} Light`, 'light');
      keep.add(this.light);
      this.light
        .getCharacteristic(C.On)
        .onGet(() => this.current().lightOn)
        .onSet((v) => this.set({ lightOn: Boolean(v) }));
      this.light
        .getCharacteristic(C.Brightness)
        .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
        .onGet(() => {
          const s = this.current();
          return s.lightOn ? s.lightBrightness : 0;
        })
        .onSet((v) => {
          const b = Math.round(Number(v));
          return this.set(b <= 0 ? { lightOn: false } : { lightOn: true, lightBrightness: Math.min(100, Math.max(1, b)) });
        });
    }

    pruneServices(accessory, keep, deps.log);
    this.poller = new Poller(() => this.refresh(), { intervalMs: deps.pollIntervalMs, log: deps.log, name: 'state' });
    this.poller.start();
  }

  dispose(): void {
    this.poller.stop();
  }

  private current(): MfState {
    if (!this.state || this.poller.consecutiveFailures >= 3) throw commFailure(this.deps.api);
    return this.state;
  }

  private speedPercent(s: MfState): number {
    return s.fanOn ? levelToPercent(s.fanSpeed, MF_SPEED_LEVELS) : 0;
  }

  private async refresh(): Promise<void> {
    this.apply(await this.deps.client.getState());
  }

  private async set(change: MfSet): Promise<void> {
    let next: MfState;
    try {
      this.deps.log.info(`→ ${JSON.stringify(change)}`);
      next = await this.deps.client.set(change);
    } catch (err) {
      this.deps.log.warn(`set ${JSON.stringify(change)} failed: ${errorMessage(err)}`);
      throw commFailure(this.deps.api);
    }
    this.apply(next);
    // HAP overwrites the characteristic with the raw written value once the handler returns;
    // re-assert the fan's actual (quantized) state on the next tick so controllers get the truth.
    setImmediate(() => this.apply(next));
  }

  private async applyFanWrite(ch: Partial<FanWrite>): Promise<void> {
    const C = this.deps.api.hap.Characteristic;
    if (ch.active === C.Active.INACTIVE || ch.speed === 0) {
      await this.set({ fanOn: false });
      return;
    }
    if (ch.speed !== undefined && ch.speed > 0) {
      const level = percentToLevel(ch.speed, MF_SPEED_LEVELS);
      this.deps.log.debug(`speed ${ch.speed}% → level ${level}/${MF_SPEED_LEVELS} (${snapPercent(ch.speed, MF_SPEED_LEVELS)}%)`);
      await this.set({ fanOn: true, fanSpeed: level });
      return;
    }
    if (ch.active === C.Active.ACTIVE) {
      await this.set({ fanOn: true });
    }
  }

  private apply(s: MfState): void {
    const C = this.deps.api.hap.Characteristic;
    this.state = s;
    this.fan.updateCharacteristic(C.Active, s.fanOn ? C.Active.ACTIVE : C.Active.INACTIVE);
    this.fan.updateCharacteristic(C.RotationSpeed, this.speedPercent(s));
    this.fan.updateCharacteristic(
      C.RotationDirection,
      s.fanDirection === 'reverse' ? C.RotationDirection.COUNTER_CLOCKWISE : C.RotationDirection.CLOCKWISE,
    );
    if (this.fan.testCharacteristic(C.SwingMode)) {
      this.fan.updateCharacteristic(C.SwingMode, s.wind ? C.SwingMode.SWING_ENABLED : C.SwingMode.SWING_DISABLED);
    }
    if (this.light) {
      this.light.updateCharacteristic(C.On, s.lightOn);
      this.light.updateCharacteristic(C.Brightness, s.lightOn ? s.lightBrightness : 0);
    }
  }
}
