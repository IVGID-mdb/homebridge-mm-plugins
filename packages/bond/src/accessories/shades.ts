import type { PlatformAccessory, Service } from 'homebridge';
import { ensureService } from '@mm/hb-core';
import type { BondContext } from '../platform.js';
import { BondAccessoryBase } from './base.js';
import type { BondDeps } from './base.js';

/**
 * Bond "MS" (motorized shades) → HomeKit WindowCovering.
 * Bond only knows open/closed (state.open) unless the device supports SetPosition, so
 * positions are 0 (closed) or 100 (open); TargetPosition ≥ 50 means Open.
 */
export class BondShades extends BondAccessoryBase {
  private readonly cover: Service;

  constructor(deps: BondDeps, accessory: PlatformAccessory, ctx: BondContext) {
    super(deps, accessory, ctx);
    const { Service: S, Characteristic: C } = deps.api.hap;
    this.cover = ensureService(deps.api, accessory, S.WindowCovering, accessory.displayName);
    this.keep.add(this.cover);
    this.cover.getCharacteristic(C.CurrentPosition).onGet(() => {
      this.guard();
      return this.position();
    });
    this.cover.getCharacteristic(C.PositionState).onGet(() => C.PositionState.STOPPED);
    this.cover
      .getCharacteristic(C.TargetPosition)
      .setProps(this.has('SetPosition') ? { minStep: 1 } : { minStep: 100 })
      .onGet(() => {
        this.guard();
        return this.position();
      })
      .onSet(async (v) => {
        const target = Number(v);
        if (this.has('SetPosition')) await this.act('SetPosition', target, { position: target });
        else if (target >= 50) await this.act(this.has('Open') ? 'Open' : 'ToggleOpen', undefined, { open: 1 });
        else await this.act(this.has('Close') ? 'Close' : 'ToggleOpen', undefined, { open: 0 });
      });
    this.finishSetup();
  }

  private position(): number {
    if (this.state.position !== undefined) return Math.max(0, Math.min(100, Number(this.state.position)));
    return this.state.open ? 100 : 0;
  }

  protected updateCharacteristics(): void {
    const C = this.deps.api.hap.Characteristic;
    const p = this.position();
    this.cover.updateCharacteristic(C.CurrentPosition, p);
    this.cover.updateCharacteristic(C.TargetPosition, p);
    this.cover.updateCharacteristic(C.PositionState, C.PositionState.STOPPED);
  }
}
