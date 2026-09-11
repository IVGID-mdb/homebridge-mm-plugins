import type { API, PlatformAccessory, Service } from 'homebridge';
import type { AccessoryHandler, Log } from '@mm/hb-core';
import { Poller, commFailure, ensureService, errorMessage, pruneServices, sanitizeVersion, setAccessoryInfo } from '@mm/hb-core';
import { viewOf } from './robot-state.js';
import type { RobotView } from './robot-state.js';
import { LR4Command } from './whisker-api.js';
import type { RobotData, WhiskerApi } from './whisker-api.js';

export interface RobotDeps {
  api: API;
  log: Log;
  whisker: WhiskerApi;
  pollIntervalMs: number;
  exposeCleanSwitch: boolean;
  exposeNightLight: boolean;
  exposeOccupancy: boolean;
  exposeResetSwitch: boolean;
}

/**
 * Litter-Robot 4 → standard HomeKit services only:
 *
 *  AirPurifier (primary)      Active ← powered → powerOn/powerOff
 *                             CurrentAirPurifierState ← INACTIVE / IDLE / PURIFYING_AIR (clean cycle)
 *                             TargetAirPurifierState = AUTO (only valid value)
 *    ↳ FilterMaintenance "Waste Drawer"  FilterChangeIndication ← isDFIFull, FilterLifeLevel ← 100 − DFILevelPercent
 *    ↳ FilterMaintenance "Litter Level"  FilterLifeLevel ← litterLevelPercentage
 *  OccupancySensor "Cat Detected"        OccupancyDetected ← cat sensor, StatusActive ← online
 *  Switch "Clean Cycle"                  On ← cycling; set On → cleanCycle (momentary)
 *  Lightbulb "Night Light"               On ← nightLightMode ≠ OFF → nightLightModeAuto / nightLightModeOff
 *  Switch "Reset Waste Gauge" (opt.)     set On → shortResetPress (momentary)
 *
 * Nothing is faked as a temperature or humidity sensor.
 */
export class LitterRobotAccessory implements AccessoryHandler {
  private readonly purifier: Service;
  private readonly drawer: Service;
  private readonly litter: Service;
  private readonly occupancy: Service | undefined;
  private readonly cleanSwitch: Service | undefined;
  private readonly nightLight: Service | undefined;
  private readonly resetSwitch: Service | undefined;
  private readonly poller: Poller;
  private data: RobotData;
  private view: RobotView;
  private cleanRequestedAt = 0;

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

    this.purifier = ensureService(deps.api, accessory, S.AirPurifier, accessory.displayName);
    keep.add(this.purifier);
    this.purifier
      .getCharacteristic(C.Active)
      .onGet(() => (this.current().powered ? C.Active.ACTIVE : C.Active.INACTIVE))
      .onSet((v) => this.command(Number(v) === C.Active.ACTIVE ? LR4Command.POWER_ON : LR4Command.POWER_OFF));
    this.purifier.getCharacteristic(C.CurrentAirPurifierState).onGet(() => this.purifierState(this.current()));
    // Set a valid value BEFORE restricting validValues, otherwise HAP warns about the default (MANUAL=0).
    this.purifier.getCharacteristic(C.TargetAirPurifierState).updateValue(C.TargetAirPurifierState.AUTO);
    this.purifier
      .getCharacteristic(C.TargetAirPurifierState)
      .setProps({ validValues: [C.TargetAirPurifierState.AUTO] })
      .onGet(() => C.TargetAirPurifierState.AUTO)
      .onSet(() => undefined);

    this.drawer = ensureService(deps.api, accessory, S.FilterMaintenance, 'Waste Drawer', 'drawer');
    keep.add(this.drawer);
    this.drawer
      .getCharacteristic(C.FilterChangeIndication)
      .onGet(() => (this.current().drawerFull ? C.FilterChangeIndication.CHANGE_FILTER : C.FilterChangeIndication.FILTER_OK));
    this.drawer.getCharacteristic(C.FilterLifeLevel).onGet(() => this.current().drawerRemainingPct);
    this.purifier.addLinkedService(this.drawer);

    this.litter = ensureService(deps.api, accessory, S.FilterMaintenance, 'Litter Level', 'litter');
    keep.add(this.litter);
    this.litter
      .getCharacteristic(C.FilterChangeIndication)
      .onGet(() => (this.current().litterPct < 20 ? C.FilterChangeIndication.CHANGE_FILTER : C.FilterChangeIndication.FILTER_OK));
    this.litter.getCharacteristic(C.FilterLifeLevel).onGet(() => this.current().litterPct);
    this.purifier.addLinkedService(this.litter);

    if (deps.exposeOccupancy) {
      this.occupancy = ensureService(deps.api, accessory, S.OccupancySensor, 'Cat Detected', 'cat');
      keep.add(this.occupancy);
      this.occupancy
        .getCharacteristic(C.OccupancyDetected)
        .onGet(() => (this.current().catDetected ? C.OccupancyDetected.OCCUPANCY_DETECTED : C.OccupancyDetected.OCCUPANCY_NOT_DETECTED));
      this.occupancy.getCharacteristic(C.StatusActive).onGet(() => this.current().online);
    }

    if (deps.exposeCleanSwitch) {
      this.cleanSwitch = ensureService(deps.api, accessory, S.Switch, 'Clean Cycle', 'clean');
      keep.add(this.cleanSwitch);
      this.cleanSwitch
        .getCharacteristic(C.On)
        .onGet(() => this.cleanSwitchOn())
        .onSet(async (v) => {
          if (!v) return; // a cycle can't be cancelled from the API; just let the state catch up
          await this.command(LR4Command.CLEAN_CYCLE);
          this.cleanRequestedAt = Date.now();
        });
    }

    if (deps.exposeNightLight) {
      this.nightLight = ensureService(deps.api, accessory, S.Lightbulb, 'Night Light', 'nightlight');
      keep.add(this.nightLight);
      this.nightLight
        .getCharacteristic(C.On)
        .onGet(() => this.current().nightLightOn)
        .onSet((v) => this.command(v ? LR4Command.NIGHT_LIGHT_MODE_AUTO : LR4Command.NIGHT_LIGHT_MODE_OFF, { nightLightMode: v ? 'AUTO' : 'OFF' }));
    }

    if (deps.exposeResetSwitch) {
      this.resetSwitch = ensureService(deps.api, accessory, S.Switch, 'Reset Waste Gauge', 'reset');
      keep.add(this.resetSwitch);
      this.resetSwitch
        .getCharacteristic(C.On)
        .onGet(() => false)
        .onSet(async (v) => {
          if (!v) return;
          await this.command(LR4Command.SHORT_RESET_PRESS, { DFILevelPercent: 0, isDFIFull: false });
          setTimeout(() => this.resetSwitch?.updateCharacteristic(C.On, false), 1000).unref?.();
        });
    }

    pruneServices(accessory, keep, deps.log);
    this.push(initial);
    this.poller = new Poller(() => this.refresh(), { intervalMs: deps.pollIntervalMs, log: deps.log, name: 'poll' });
    this.poller.start();
  }

  dispose(): void {
    this.poller.stop();
  }

  /** Called by the platform when its account-wide poll already fetched fresh data. */
  update(data: RobotData): void {
    this.push(data);
  }

  private current(): RobotView {
    if (this.poller.consecutiveFailures >= 3) throw commFailure(this.deps.api);
    return this.view;
  }

  private cleanSwitchOn(): boolean {
    return this.view.cycling || Date.now() - this.cleanRequestedAt < 20_000;
  }

  private purifierState(v: RobotView): number {
    const C = this.deps.api.hap.Characteristic;
    if (!v.powered) return C.CurrentAirPurifierState.INACTIVE;
    if (v.cycling) return C.CurrentAirPurifierState.PURIFYING_AIR;
    return C.CurrentAirPurifierState.IDLE;
  }

  private async refresh(): Promise<void> {
    const fresh = await this.deps.whisker.getRobot(this.data.serial);
    if (fresh) this.push(fresh);
  }

  private async command(cmd: (typeof LR4Command)[keyof typeof LR4Command], expected: Partial<RobotData> = {}): Promise<void> {
    try {
      this.deps.log.info(`→ ${cmd}`);
      await this.deps.whisker.sendCommand(this.data.serial, cmd);
    } catch (err) {
      this.deps.log.warn(`${cmd} failed: ${errorMessage(err)}`);
      throw commFailure(this.deps.api);
    }
    const optimistic: Partial<RobotData> =
      cmd === LR4Command.POWER_ON
        ? { unitPowerStatus: 'ON', robotStatus: 'ROBOT_IDLE' }
        : cmd === LR4Command.POWER_OFF
          ? { unitPowerStatus: 'OFF', robotStatus: 'ROBOT_POWER_OFF' }
          : cmd === LR4Command.CLEAN_CYCLE
            ? { robotStatus: 'ROBOT_CLEAN' }
            : {};
    const next = { ...this.data, ...optimistic, ...expected };
    setImmediate(() => this.push(next));
    // The robot reports back within a few seconds; confirm then, and again a bit later.
    setTimeout(() => void this.poller.now(), 5000).unref?.();
    setTimeout(() => void this.poller.now(), 30_000).unref?.();
  }

  private push(data: RobotData): void {
    const C = this.deps.api.hap.Characteristic;
    this.data = data;
    const v = (this.view = viewOf(data));
    this.purifier.updateCharacteristic(C.Active, v.powered ? C.Active.ACTIVE : C.Active.INACTIVE);
    this.purifier.updateCharacteristic(C.CurrentAirPurifierState, this.purifierState(v));
    this.purifier.updateCharacteristic(C.TargetAirPurifierState, C.TargetAirPurifierState.AUTO);
    this.drawer.updateCharacteristic(C.FilterChangeIndication, v.drawerFull ? C.FilterChangeIndication.CHANGE_FILTER : C.FilterChangeIndication.FILTER_OK);
    this.drawer.updateCharacteristic(C.FilterLifeLevel, v.drawerRemainingPct);
    this.litter.updateCharacteristic(C.FilterChangeIndication, v.litterPct < 20 ? C.FilterChangeIndication.CHANGE_FILTER : C.FilterChangeIndication.FILTER_OK);
    this.litter.updateCharacteristic(C.FilterLifeLevel, v.litterPct);
    this.occupancy?.updateCharacteristic(C.OccupancyDetected, v.catDetected ? C.OccupancyDetected.OCCUPANCY_DETECTED : C.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    this.occupancy?.updateCharacteristic(C.StatusActive, v.online);
    this.cleanSwitch?.updateCharacteristic(C.On, this.cleanSwitchOn());
    this.nightLight?.updateCharacteristic(C.On, v.nightLightOn);
    if (data.espFirmware) {
      this.accessory
        .getService(this.deps.api.hap.Service.AccessoryInformation)
        ?.updateCharacteristic(C.FirmwareRevision, sanitizeVersion(String(data.espFirmware)));
    }
  }
}
