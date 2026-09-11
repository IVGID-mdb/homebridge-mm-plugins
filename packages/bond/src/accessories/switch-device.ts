import type { PlatformAccessory, Service } from 'homebridge';
import { ensureService } from '@mm/hb-core';
import type { BondContext } from '../platform.js';
import { BondAccessoryBase } from './base.js';
import type { BondDeps } from './base.js';

/**
 * Bond "GX" (generic) and "FP" (fireplace) devices → HomeKit Switch.
 * HomeKit has no fireplace type; a Switch is the honest representation of an RF on/off.
 */
export class BondSwitchDevice extends BondAccessoryBase {
  private readonly sw: Service;

  constructor(deps: BondDeps, accessory: PlatformAccessory, ctx: BondContext) {
    super(deps, accessory, ctx);
    const { Service: S, Characteristic: C } = deps.api.hap;
    this.sw = ensureService(deps.api, accessory, S.Switch, accessory.displayName);
    this.keep.add(this.sw);
    this.sw
      .getCharacteristic(C.On)
      .onGet(() => {
        this.guard();
        return Boolean(this.state.power);
      })
      .onSet(async (v) => {
        const on = Boolean(v);
        const expected = { power: on ? 1 : 0 };
        if (this.has('TurnOn') && this.has('TurnOff')) await this.act(on ? 'TurnOn' : 'TurnOff', undefined, expected);
        else if (Boolean(this.state.power) !== on && this.has('TogglePower')) await this.act('TogglePower', undefined, expected);
      });
    this.finishSetup();
  }

  protected updateCharacteristics(): void {
    this.sw.updateCharacteristic(this.deps.api.hap.Characteristic.On, Boolean(this.state.power));
  }
}
