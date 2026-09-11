import type { PlatformAccessory, Service } from 'homebridge';
import { ensureService } from '@mm/hb-core';
import type { BondContext } from '../platform.js';
import { BondAccessoryBase } from './base.js';
import type { BondDeps } from './base.js';

/** Bond "LT" device → HomeKit Lightbulb (On, Brightness when SetBrightness exists). */
export class BondLight extends BondAccessoryBase {
  private readonly light: Service;

  constructor(deps: BondDeps, accessory: PlatformAccessory, ctx: BondContext) {
    super(deps, accessory, ctx);
    const { Service: S, Characteristic: C } = deps.api.hap;
    this.light = ensureService(deps.api, accessory, S.Lightbulb, accessory.displayName);
    this.keep.add(this.light);
    this.light
      .getCharacteristic(C.On)
      .onGet(() => {
        this.guard();
        return Boolean(this.state.light ?? this.state.power);
      })
      .onSet(async (v) => {
        const on = Boolean(v);
        const expected = { light: on ? 1 : 0, power: on ? 1 : 0 };
        if (this.has('TurnLightOn') && this.has('TurnLightOff')) await this.act(on ? 'TurnLightOn' : 'TurnLightOff', undefined, expected);
        else if (this.has('TurnOn') && this.has('TurnOff')) await this.act(on ? 'TurnOn' : 'TurnOff', undefined, expected);
        else if (Boolean(this.state.light ?? this.state.power) !== on) {
          await this.act(this.has('ToggleLight') ? 'ToggleLight' : 'TogglePower', undefined, expected);
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
          if (b <= 0) await this.act(this.has('TurnLightOff') ? 'TurnLightOff' : 'TurnOff', undefined, { light: 0, power: 0 });
          else await this.act('SetBrightness', b, { light: 1, power: 1, brightness: b });
        });
    }
    this.finishSetup();
  }

  protected updateCharacteristics(): void {
    const C = this.deps.api.hap.Characteristic;
    this.light.updateCharacteristic(C.On, Boolean(this.state.light ?? this.state.power));
    if (this.light.testCharacteristic(C.Brightness) && this.state.brightness !== undefined) {
      this.light.updateCharacteristic(C.Brightness, Math.max(0, Math.min(100, Number(this.state.brightness))));
    }
  }
}
