import type { PlatformAccessory, Service } from 'homebridge';
import { WriteCoalescer, ensureService, levelToPercent, percentToLevel, snapPercent } from '@mm/hb-core';
import type { BondContext } from '../platform.js';
import { BondAccessoryBase } from './base.js';
import type { BondDeps } from './base.js';

interface FanWrite {
  active: number;
  speed: number;
}

/**
 * Bond "CF" device → HomeKit Fanv2 (+ Lightbulb when the fan has a light).
 *
 *  Fanv2.Active            ← state.power            → TurnOn / TurnOff
 *  Fanv2.RotationSpeed     ← state.speed / max_speed → SetSpeed(level)   (0 % → TurnOff)
 *  Fanv2.RotationDirection ← state.direction (1 fwd = CLOCKWISE, -1 = COUNTER_CLOCKWISE)
 *                                                    → SetDirection(±1) or ToggleDirection
 *  Lightbulb.On            ← state.light            → TurnLightOn / TurnLightOff (or ToggleLight)
 *  Lightbulb.Brightness    ← state.brightness       → SetBrightness (only if the device has it)
 *
 * No "toggle"/"dimmer" pseudo-switches: HomeKit has no concept for them and they confuse Siri.
 */
export class BondCeilingFan extends BondAccessoryBase {
  private readonly fan: Service;
  private readonly light: Service | undefined;
  private readonly levels: number;
  private readonly writes: WriteCoalescer<FanWrite>;

  constructor(deps: BondDeps, accessory: PlatformAccessory, ctx: BondContext) {
    super(deps, accessory, ctx);
    const { Service: S, Characteristic: C } = deps.api.hap;
    const max = Number(ctx.device.properties.max_speed);
    this.levels = Number.isInteger(max) && max > 0 ? max : 3;

    this.fan = ensureService(deps.api, accessory, S.Fanv2, accessory.displayName, { primary: true });
    this.keep.add(this.fan);
    this.writes = new WriteCoalescer<FanWrite>((ch) => this.applyFanWrite(ch));

    this.fan
      .getCharacteristic(C.Active)
      .onGet(() => {
        this.guard();
        return this.state.power ? C.Active.ACTIVE : C.Active.INACTIVE;
      })
      .onSet((v) => this.writes.write('active', Number(v)));

    // Only publish a speed slider the device can actually satisfy. A fan with IncreaseSpeed but no
    // SetSpeed cannot be sent to a chosen speed, and advertising the control anyway would give the
    // user a slider that silently does nothing but switch the fan on.
    if (this.has('SetSpeed')) {
      this.fan
        .getCharacteristic(C.RotationSpeed)
        .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
        .onGet(() => {
          this.guard();
          return this.speedPercent();
        })
        .onSet((v) => this.writes.write('speed', Number(v)));
    } else {
      const rs = this.fan.getCharacteristic(C.RotationSpeed);
      if (rs) this.fan.removeCharacteristic(rs);
    }

    if (this.has('SetDirection') || this.has('ToggleDirection')) {
      this.fan
        .getCharacteristic(C.RotationDirection)
        .onGet(() => {
          this.guard();
          return this.state.direction === -1 ? C.RotationDirection.COUNTER_CLOCKWISE : C.RotationDirection.CLOCKWISE;
        })
        .onSet(async (v) => {
          const wantReverse = Number(v) === C.RotationDirection.COUNTER_CLOCKWISE;
          const dir = wantReverse ? -1 : 1;
          if (this.has('SetDirection')) {
            await this.act('SetDirection', dir, { direction: dir });
          } else if ((this.state.direction === -1) !== wantReverse) {
            await this.act('ToggleDirection', undefined, { direction: dir });
          }
        });
    }

    if (this.has('TurnLightOn') || this.has('ToggleLight')) {
      this.light = ensureService(deps.api, accessory, S.Lightbulb, `${accessory.displayName} Light`, 'light');
      this.keep.add(this.light);
      this.light
        .getCharacteristic(C.On)
        .onGet(() => {
          this.guard();
          return Boolean(this.state.light);
        })
        .onSet(async (v) => {
          const on = Boolean(v);
          if (this.has('TurnLightOn') && this.has('TurnLightOff')) {
            await this.act(on ? 'TurnLightOn' : 'TurnLightOff', undefined, { light: on ? 1 : 0 });
          } else if (Boolean(this.state.light) !== on) {
            await this.act('ToggleLight', undefined, { light: on ? 1 : 0 });
          }
        });
      if (this.has('SetBrightness')) {
        this.light
          .getCharacteristic(C.Brightness)
          .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
          .onGet(() => {
            this.guard();
            return Number(this.state.brightness ?? 100);
          })
          .onSet(async (v) => {
            const b = Math.round(Number(v));
            if (b <= 0) await this.act('TurnLightOff', undefined, { light: 0 });
            else await this.act('SetBrightness', b, { light: 1, brightness: b });
          });
      }
    }
    this.finishSetup();
  }

  private speedPercent(): number {
    if (!this.state.power) return 0;
    const level = Number(this.state.speed ?? 0);
    return levelToPercent(level, this.levels);
  }

  private async applyFanWrite(ch: Partial<FanWrite>): Promise<void> {
    const C = this.deps.api.hap.Characteristic;
    const wantsOff = ch.active === C.Active.INACTIVE || ch.speed === 0;
    if (wantsOff) {
      await this.act('TurnOff', undefined, { power: 0 });
      return;
    }
    if (ch.speed !== undefined && ch.speed > 0) {
      const level = percentToLevel(ch.speed, this.levels);
      this.deps.log.debug(`speed ${ch.speed}% → level ${level}/${this.levels} (${snapPercent(ch.speed, this.levels)}%)`);
      if (this.has('SetSpeed')) {
        // Bond's SetSpeed powers the fan on as a side effect (belief state reports power:1).
        await this.act('SetSpeed', level, { power: 1, speed: level });
      } else {
        await this.act('TurnOn', undefined, { power: 1 });
      }
      return;
    }
    if (ch.active === C.Active.ACTIVE) {
      await this.act('TurnOn', undefined, { power: 1 });
    }
  }

  protected updateCharacteristics(): void {
    const C = this.deps.api.hap.Characteristic;
    const on = Boolean(this.state.power);
    this.fan.updateCharacteristic(C.Active, on ? C.Active.ACTIVE : C.Active.INACTIVE);
    if (this.fan.testCharacteristic(C.RotationSpeed)) {
      this.fan.updateCharacteristic(C.RotationSpeed, this.speedPercent());
    }
    if (this.fan.testCharacteristic(C.RotationDirection)) {
      this.fan.updateCharacteristic(
        C.RotationDirection,
        this.state.direction === -1 ? C.RotationDirection.COUNTER_CLOCKWISE : C.RotationDirection.CLOCKWISE,
      );
    }
    if (this.light) {
      this.light.updateCharacteristic(C.On, Boolean(this.state.light));
      if (this.light.testCharacteristic(C.Brightness) && this.state.brightness !== undefined) {
        this.light.updateCharacteristic(C.Brightness, Math.max(0, Math.min(100, Number(this.state.brightness))));
      }
    }
  }
}
