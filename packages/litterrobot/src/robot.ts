import type { API, PlatformAccessory, Service } from 'homebridge';
import type { AccessoryHandler, Log } from '@mm/hb-core';
import { Poller, commFailure, ensureService, errorMessage, pruneServices, sanitizeVersion, setAccessoryInfo } from '@mm/hb-core';
import { attentionOf, viewOf } from './robot-state.js';
import type { AttentionState, RobotView } from './robot-state.js';
import { LR4Command } from './whisker-api.js';
import type { RobotData, WhiskerApi } from './whisker-api.js';

export interface RobotDeps {
  api: API;
  log: Log;
  whisker: WhiskerApi;
  pollIntervalMs: number;
  exposeDrawerAlert: boolean;
  exposeResetSwitch: boolean;
  exposeCleanCycle: boolean;
  alertWhenPoweredOff: boolean;
  attentionDebounceMs: number;
  litterLowPercent: number;
  staleMs: number;
}

/**
 * Litter-Robot 4, scoped to the four things that actually matter to the owner: how full the waste
 * drawer is, telling it you emptied it, whether anything is wrong, and running a cycle now.
 *
 *  FilterMaintenance "Waste Drawer"   FilterChangeIndication ← drawer full
 *                                     FilterLifeLevel        ← 100 − DFILevelPercent (remaining capacity)
 *                                     ResetFilterIndication  → shortResetPress
 *  OccupancySensor "Drawer Full"      the same fact on a service that certainly renders and can
 *                                     drive an automation. Computed once and fanned out, so the
 *                                     two can never disagree.
 *  Switch "Empty Drawer"              momentary → shortResetPress. Belt and braces: the filter
 *                                     service's own reset may not be reachable by touch, and this
 *                                     is the control the owner needs most.
 *  OccupancySensor "Needs Attention"  motor fault, bonnet off, dirty sensor, hopper trouble,
 *                                     litter low, switched off, or not reporting in.
 *  Switch "Clean Cycle"               → cleanCycle, REFUSED while a cat is in the globe.
 *
 * Deliberately absent: night light, child lock, panel brightness, clump time, sleep schedule, cat
 * weight and lifetime counters. Also absent is a cat-overdue alarm: this household has two cats and
 * the robot reports only "a cat", so such an alarm could not detect the case that matters, one cat
 * of two falling ill.
 *
 * Nothing is faked as a temperature, humidity or air-quality reading.
 */
export class LitterRobotAccessory implements AccessoryHandler {
  private readonly drawer: Service;
  private readonly drawerAlert: Service | undefined;
  private readonly resetSwitch: Service | undefined;
  private readonly attention: Service;
  private readonly cleanSwitch: Service | undefined;
  private readonly poller: Poller;
  private readonly timers = new Set<NodeJS.Timeout>();
  private data: RobotData;
  private view: RobotView;
  private cleanRequestedAt = 0;
  private offlineSince: number | undefined;
  private poweredOffSince: number | undefined;
  private lastReasons = '';
  private warnedCatValue = '';
  private disposed = false;

  constructor(
    private readonly deps: RobotDeps,
    private readonly accessory: PlatformAccessory,
    initial: RobotData,
  ) {
    const { Service: S, Characteristic: C } = deps.api.hap;
    this.data = initial;
    this.view = viewOf(initial);
    setAccessoryInfo(deps.api, accessory, {
      manufacturer: 'Whisker',
      model: 'Litter-Robot 4',
      serialNumber: initial.serial,
      firmwareRevision: sanitizeVersion(initial.espFirmware ?? ''),
    });
    const keep = new Set<Service>();

    // ---- the chore: how full, and telling it you emptied it -------------------------------
    this.drawer = ensureService(deps.api, accessory, S.FilterMaintenance, 'Waste Drawer', 'drawer');
    keep.add(this.drawer);
    this.drawer
      .getCharacteristic(C.FilterChangeIndication)
      .onGet(() => (this.guarded().drawerFull ? C.FilterChangeIndication.CHANGE_FILTER : C.FilterChangeIndication.FILTER_OK));
    this.drawer.getCharacteristic(C.FilterLifeLevel).onGet(() => this.guarded().drawerRemainingPct);
    // Write-only, min 1 max 1. Apple defines writing 1 as "the user dealt with it".
    this.drawer.getCharacteristic(C.ResetFilterIndication).onSet(() => this.emptied());

    if (deps.exposeDrawerAlert) {
      this.drawerAlert = ensureService(deps.api, accessory, S.OccupancySensor, 'Drawer Full', 'drawer-alert');
      keep.add(this.drawerAlert);
      this.drawerAlert
        .getCharacteristic(C.OccupancyDetected)
        .onGet(() =>
          this.guarded().drawerFull ? C.OccupancyDetected.OCCUPANCY_DETECTED : C.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
        );
      this.drawerAlert.getCharacteristic(C.StatusActive).onGet(() => this.readingIsLive());
      this.drawerAlert.addLinkedService(this.drawer);
    }

    if (deps.exposeResetSwitch) {
      this.resetSwitch = ensureService(deps.api, accessory, S.Switch, 'Empty Drawer', 'reset');
      keep.add(this.resetSwitch);
      this.resetSwitch
        .getCharacteristic(C.On)
        .onGet(() => false)
        .onSet(async (v) => {
          if (!v) return;
          await this.emptied();
          this.later(() => this.resetSwitch?.updateCharacteristic(C.On, false), 1000);
        });
    }

    // ---- anything wrong -------------------------------------------------------------------
    // Deliberately NOT behind the comm-failure guard: this is the one service that must keep
    // answering when the cloud is unreachable, otherwise the failure it exists to report is the
    // failure that silences it.
    this.attention = ensureService(deps.api, accessory, S.OccupancySensor, 'Needs Attention', 'attention');
    keep.add(this.attention);
    this.attention
      .getCharacteristic(C.OccupancyDetected)
      .onGet(() =>
        this.attentionState().needsAttention
          ? C.OccupancyDetected.OCCUPANCY_DETECTED
          : C.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      );
    this.attention.getCharacteristic(C.StatusActive).onGet(() => true);
    this.attention.getCharacteristic(C.StatusFault).onGet(() =>
      this.attentionState().hardwareFault ? C.StatusFault.GENERAL_FAULT : C.StatusFault.NO_FAULT,
    );

    // ---- run a cycle now ------------------------------------------------------------------
    if (deps.exposeCleanCycle) {
      this.cleanSwitch = ensureService(deps.api, accessory, S.Switch, 'Clean Cycle', 'clean');
      keep.add(this.cleanSwitch);
      this.cleanSwitch
        .getCharacteristic(C.On)
        .onGet(() => this.cleanSwitchOn())
        .onSet(async (v) => {
          if (!v) return; // the API cannot abort a running cycle; let the true state spring back
          this.refuseIfCatInside();
          this.cleanRequestedAt = Date.now();
          await this.command(LR4Command.CLEAN_CYCLE, () => {
            this.cleanSwitch?.updateCharacteristic(C.On, true);
          });
        });
    }

    // Exactly one primary service. Both branches are asserted, never just the winning one, because
    // the flag is persisted in the accessory cache and a restored service keeps it across a config
    // change, which would otherwise leave two services flagged primary.
    this.drawer.setPrimaryService(!this.drawerAlert);
    this.drawerAlert?.setPrimaryService(true);

    pruneServices(accessory, keep, deps.log);
    // The poller must exist before the first push, because the reachability check reads its
    // failure count. Building it later threw inside the constructor, which the platform caught,
    // leaving an accessory whose services existed but whose handler was never registered.
    this.poller = new Poller(() => this.refresh(), { intervalMs: deps.pollIntervalMs, log: deps.log, name: 'poll' });
    this.push(initial);
    this.poller.start();
  }

  dispose(): void {
    this.disposed = true;
    this.poller.stop();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** Called by the platform (and tests) when fresh data is already in hand. */
  update(data: RobotData): void {
    this.push(data);
  }

  /** A timer that is cancelled on shutdown and never fires into a disposed accessory. */
  private later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.disposed) fn();
    }, ms);
    t.unref?.();
    this.timers.add(t);
  }

  // ---- safety ------------------------------------------------------------------------------

  /**
   * A cycle rotates the globe. Exposing that to Siri, scenes and automations without a guard means
   * one misheard phrase can turn it with a cat inside, so a detected cat refuses the write outright.
   * The underlying predicate fails closed: an unfamiliar cat value counts as a cat.
   */
  private refuseIfCatInside(): void {
    if (!this.view.catDetected) return;
    this.deps.log.warn('Refusing to start a clean cycle: the robot reports a cat in the globe.');
    throw new this.deps.api.hap.HapStatusError(this.deps.api.hap.HAPStatus.RESOURCE_BUSY);
  }

  // ---- state -------------------------------------------------------------------------------

  /** For everything except the attention sensor: report No Response rather than a stale number. */
  private guarded(): RobotView {
    if (this.poller.consecutiveFailures >= 3) throw commFailure(this.deps.api);
    return this.view;
  }

  private isStale(): boolean {
    const seen = this.view.lastSeenAt;
    if (seen === undefined) return false;
    return Date.now() - seen > this.deps.staleMs;
  }

  /**
   * Whether the drawer reading currently means anything. A switched-off robot is not filling its
   * drawer, so the number it last reported is frozen and must not be advertised as live.
   */
  private readingIsLive(): boolean {
    return this.view.powered && !this.isStale() && this.poller.consecutiveFailures === 0;
  }

  /**
   * One clock for "something is abnormal", carried across when the cause changes. Handing off
   * between two independent clocks used to reset the debounce, so the alert cleared for a whole
   * window at the moment a switched-off robot also went silent.
   */
  private updateSustained(observed: boolean): void {
    const now = Date.now();
    const reachable = observed && this.view.online && !this.isStale();
    if (reachable) {
      const carried = this.offlineSince;
      this.offlineSince = undefined;
      if (this.view.poweredOff) this.poweredOffSince ??= carried ?? now;
      else this.poweredOffSince = undefined;
    } else {
      const carried = this.poweredOffSince;
      // While unreachable we cannot see the power switch, so do not claim it is off.
      this.poweredOffSince = undefined;
      this.offlineSince ??= carried ?? now;
    }
  }

  private sustainedFor(since: number | undefined): boolean {
    return since !== undefined && Date.now() - since >= this.deps.attentionDebounceMs;
  }

  private attentionState(): AttentionState {
    return attentionOf(
      this.view,
      {
        offline: this.sustainedFor(this.offlineSince),
        poweredOff: this.deps.alertWhenPoweredOff && this.sustainedFor(this.poweredOffSince),
      },
      this.deps.litterLowPercent,
    );
  }

  private cleanSwitchOn(): boolean {
    return this.view.cycling || Date.now() - this.cleanRequestedAt < 20_000;
  }

  // ---- device ------------------------------------------------------------------------------

  private async emptied(): Promise<void> {
    const C = this.deps.api.hap.Characteristic;
    await this.command(LR4Command.SHORT_RESET_PRESS, () => {
      // Show the acknowledgement immediately, but only on the characteristics the command targets.
      // The confirming poll replaces these with whatever the robot actually reports.
      this.drawer.updateCharacteristic(C.FilterLifeLevel, 100);
      this.drawer.updateCharacteristic(C.FilterChangeIndication, C.FilterChangeIndication.FILTER_OK);
      this.drawerAlert?.updateCharacteristic(C.OccupancyDetected, C.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    });
  }

  private async refresh(): Promise<void> {
    let fresh: RobotData | undefined;
    try {
      fresh = await this.deps.whisker.getRobot(this.data.serial);
    } catch (err) {
      this.updateSustained(false);
      this.pushAttention();
      throw err;
    }
    if (fresh) {
      this.push(fresh);
      return;
    }
    // A poll that succeeds but returns no robot is not evidence the robot is healthy.
    this.updateSustained(false);
    this.pushAttention();
    throw new Error('the account returned no record for this robot');
  }

  /**
   * Send a command. The optimistic callback may touch only the characteristics the command
   * targets; it must never be folded into the stored payload, because that payload is what the
   * fault predicate reads and fabricating a status there erases real causes such as a removed
   * bonnet and resets the outage clock from data the robot never sent.
   */
  private async command(cmd: (typeof LR4Command)[keyof typeof LR4Command], optimistic?: () => void): Promise<void> {
    try {
      this.deps.log.info(`→ ${cmd}`);
      await this.deps.whisker.sendCommand(this.data.serial, cmd);
    } catch (err) {
      this.deps.log.warn(`${cmd} failed: ${errorMessage(err)}`);
      throw commFailure(this.deps.api);
    }
    if (optimistic) setImmediate(optimistic);
    // The robot reports back within a few seconds; confirm then, and again once it has settled.
    this.later(() => void this.poller.now(), 5000);
    this.later(() => void this.poller.now(), 30_000);
  }

  // ---- publishing --------------------------------------------------------------------------

  private push(data: RobotData): void {
    const C = this.deps.api.hap.Characteristic;
    this.data = data;
    this.view = viewOf(data);
    this.updateSustained(true);

    if (!this.view.catDetectRecognised && this.warnedCatValue !== this.view.catDetectRaw) {
      this.warnedCatValue = this.view.catDetectRaw;
      this.deps.log.warn(
        `Unfamiliar cat sensor value "${this.view.catDetectRaw}". Treating it as a cat present, ` +
          'so a clean cycle will be refused until it clears.',
      );
    }

    // One evaluation of the drawer, fanned out, so the gauge and the alert cannot disagree.
    const full = this.view.drawerFull;
    this.drawer.updateCharacteristic(C.FilterChangeIndication, full ? C.FilterChangeIndication.CHANGE_FILTER : C.FilterChangeIndication.FILTER_OK);
    this.drawer.updateCharacteristic(C.FilterLifeLevel, this.view.drawerRemainingPct);
    this.drawerAlert?.updateCharacteristic(
      C.OccupancyDetected,
      full ? C.OccupancyDetected.OCCUPANCY_DETECTED : C.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    );
    this.drawerAlert?.updateCharacteristic(C.StatusActive, this.readingIsLive());
    this.cleanSwitch?.updateCharacteristic(C.On, this.cleanSwitchOn());
    this.pushAttention();

    if (data.espFirmware) {
      this.accessory
        .getService(this.deps.api.hap.Service.AccessoryInformation)
        ?.updateCharacteristic(C.FirmwareRevision, sanitizeVersion(String(data.espFirmware)));
    }
  }

  private pushAttention(): void {
    const C = this.deps.api.hap.Characteristic;
    const a = this.attentionState();
    this.attention.updateCharacteristic(
      C.OccupancyDetected,
      a.needsAttention ? C.OccupancyDetected.OCCUPANCY_DETECTED : C.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    );
    this.attention.updateCharacteristic(C.StatusActive, true);
    this.attention.updateCharacteristic(C.StatusFault, a.hardwareFault ? C.StatusFault.GENERAL_FAULT : C.StatusFault.NO_FAULT);
    const joined = a.reasons.join(', ');
    if (joined !== this.lastReasons) {
      this.lastReasons = joined;
      if (joined) this.deps.log.warn(`Needs attention: ${joined}`);
      else this.deps.log.info('Nothing needs attention.');
    }
  }
}
