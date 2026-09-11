import type { API, PlatformAccessory, Service } from 'homebridge';
import type { AccessoryHandler, Log } from '@mm/hb-core';
import { Poller, commFailure, errorMessage, pruneServices, setAccessoryInfo } from '@mm/hb-core';
import type { BondApi, BondDeviceState } from '../bond-api.js';
import type { BondContext } from '../platform.js';

export interface BondDeps {
  api: API;
  log: Log;
  bond: BondApi;
  pollIntervalMs: number;
  /** Register for push state; returns an unsubscribe function. */
  subscribe: (cb: (state: BondDeviceState) => void) => () => void;
}

/**
 * Common plumbing for every Bond device:
 *  - AccessoryInformation from the bridge's version info,
 *  - a state poller (safety net) plus push subscription (instant),
 *  - a single `applyState` funnel so HomeKit is always updated from one place,
 *  - HAP "No Response" when the bridge has been unreachable for a while.
 */
export abstract class BondAccessoryBase implements AccessoryHandler {
  protected state: BondDeviceState = {};
  protected readonly poller: Poller;
  private readonly unsubscribe: () => void;
  protected readonly keep = new Set<Service>();
  protected hasState = false;

  constructor(
    protected readonly deps: BondDeps,
    protected readonly accessory: PlatformAccessory,
    protected readonly ctx: BondContext,
  ) {
    setAccessoryInfo(deps.api, accessory, {
      manufacturer: ctx.make || 'Olibra',
      model: `${ctx.model || 'Bond'} / ${ctx.device.info.template ?? ctx.device.info.type}`,
      serialNumber: `${ctx.bondId}-${ctx.device.id}`,
      firmwareRevision: ctx.firmware,
    });
    this.poller = new Poller(() => this.refresh(), {
      intervalMs: deps.pollIntervalMs,
      log: deps.log,
      name: 'state',
    });
    this.unsubscribe = deps.subscribe((s) => {
      deps.log.debug(`push state ${JSON.stringify(s)}`);
      this.applyState(s);
    });
  }

  /** Subclasses create services in their constructor, then call this. */
  protected finishSetup(): void {
    pruneServices(this.accessory, this.keep, this.deps.log);
    this.poller.start();
  }

  dispose(): void {
    this.poller.stop();
    this.unsubscribe();
  }

  get device() {
    return this.ctx.device;
  }

  get id(): string {
    return this.ctx.device.id;
  }

  has(action: string): boolean {
    return this.ctx.device.info.actions.includes(action);
  }

  protected async refresh(): Promise<void> {
    const s = await this.deps.bond.getState(this.id);
    this.applyState(s);
  }

  protected applyState(s: BondDeviceState): void {
    this.state = { ...this.state, ...s };
    this.hasState = true;
    this.updateCharacteristics();
  }

  /** Push current `this.state` into HAP characteristics with updateValue (never setValue). */
  protected abstract updateCharacteristics(): void;

  /**
   * Run a Bond action, apply the expected belief-state change locally (so HomeKit shows the
   * canonical value right after HAP finishes the write), then re-read state shortly after —
   * Bond updates its own belief state immediately, so a quick GET confirms it.
   */
  protected async act(action: string, argument?: number, expected: BondDeviceState = {}): Promise<void> {
    try {
      this.deps.log.info(`→ ${action}${argument !== undefined ? `(${argument})` : ''}`);
      await this.deps.bond.action(this.id, action, argument);
    } catch (err) {
      this.deps.log.warn(`${action} failed: ${errorMessage(err)}`);
      throw commFailure(this.deps.api);
    }
    this.state = { ...this.state, ...expected };
    // HAP overwrites the characteristic with the raw written value once the handler returns;
    // re-assert our quantized/derived values on the next tick so controllers get the truth.
    setImmediate(() => this.updateCharacteristics());
    setTimeout(() => void this.poller.now(), 400).unref?.();
  }

  /** For onGet: if we have never heard from the device, tell HomeKit rather than guess. */
  protected guard(): void {
    if (!this.hasState || this.poller.consecutiveFailures >= 3) {
      throw commFailure(this.deps.api);
    }
  }
}
