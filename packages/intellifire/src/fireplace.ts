import type { API, PlatformAccessory, Service } from 'homebridge';
import type { AccessoryHandler, Log } from '@mm/hb-core';
import {
  Poller,
  WriteCoalescer,
  clamp,
  commFailure,
  ensureService,
  errorMessage,
  levelToPercent,
  percentToLevel,
  pruneServices,
  setAccessoryInfo,
} from '@mm/hb-core';
import type { FireplaceCommand, FireplaceState } from './state.js';
import { FAN_LEVELS, FLAME_LEVELS, LIGHT_LEVELS, SETPOINT_MAX_C, SETPOINT_MIN_C, parseFireplaceState } from './state.js';
import type { FireplaceTransport } from './transport.js';

export interface FireplaceDeps {
  api: API;
  log: Log;
  transport: FireplaceTransport;
  pollIntervalMs: number;
  exposeSwitch: boolean;
  exposeBlower: boolean;
  exposeLight: boolean;
}

export interface FireplaceIdentity {
  serial: string;
  name: string;
  brand: string;
}

interface HeaterWrite {
  active: number;
  flame: number;
  setpoint: number;
}

interface BlowerWrite {
  active: number;
  speed: number;
}

/**
 * IntelliFire fireplace → HomeKit HeaterCooler (the only HAP service with heat + temperature
 * + a "level" slider), plus optional Fanv2 (blower), Lightbulb (accent light) and Switch.
 *
 *  HeaterCooler.Active                      ← power              → power 0/1
 *  HeaterCooler.CurrentHeaterCoolerState    ← INACTIVE / HEATING (IDLE when thermostat is satisfied)
 *  HeaterCooler.TargetHeaterCoolerState     = HEAT (only valid value)
 *  HeaterCooler.CurrentTemperature          ← temperature (°C)
 *  HeaterCooler.HeatingThresholdTemperature ← setpoint/100 (°C) → thermostat_setpoint (°C×100)
 *      Always published: a heater must include it (HAPServiceTypes.h). Writes are refused when the
 *      unit reports no thermostat feature, rather than the characteristic being withheld.
 *  HeaterCooler.RotationSpeed               ← height 0..4 as 0/25/50/75/100 % → flame_height
 *      NOTE: RotationSpeed is defined as fan speed, and the blower already has its own Fanv2.
 *      Carrying flame height here is under review; see docs/homekit/heating.md.
 *  Fanv2 "Blower".Active/RotationSpeed      ← fanspeed 0..4     → fan_speed                        [if fan]
 *  Lightbulb "Accent Light".On/Brightness   ← light 0..3        → light                            [if light]
 *  Switch (optional)                        ← power              → power
 */
export class FireplaceAccessory implements AccessoryHandler {
  private readonly heater: Service;
  private readonly blower: Service | undefined;
  private readonly light: Service | undefined;
  private readonly sw: Service | undefined;
  private readonly poller: Poller;
  private readonly heaterWrites: WriteCoalescer<HeaterWrite>;
  private readonly blowerWrites: WriteCoalescer<BlowerWrite>;
  private state: FireplaceState | undefined;

  constructor(
    private readonly deps: FireplaceDeps,
    private readonly accessory: PlatformAccessory,
    identity: FireplaceIdentity,
    initial?: FireplaceState,
  ) {
    const { Service: S, Characteristic: C } = deps.api.hap;
    this.state = initial;
    setAccessoryInfo(deps.api, accessory, {
      manufacturer: 'Hearth & Home',
      model: `${identity.brand || 'IntelliFire'} fireplace`,
      serialNumber: identity.serial,
      firmwareRevision: initial?.firmware,
    });
    const keep = new Set<Service>();

    this.heater = ensureService(deps.api, accessory, S.HeaterCooler, accessory.displayName, { primary: true });
    keep.add(this.heater);
    this.heaterWrites = new WriteCoalescer<HeaterWrite>((ch) => this.applyHeaterWrite(ch));
    this.blowerWrites = new WriteCoalescer<BlowerWrite>((ch) => this.applyBlowerWrite(ch));

    this.heater
      .getCharacteristic(C.Active)
      .onGet(() => (this.current().power ? C.Active.ACTIVE : C.Active.INACTIVE))
      .onSet((v) => this.heaterWrites.write('active', Number(v)));
    this.heater.getCharacteristic(C.CurrentHeaterCoolerState).onGet(() => this.currentHeaterState(this.current()));
    // Set a valid value BEFORE restricting validValues, otherwise HAP warns about the default (AUTO=0).
    this.heater.getCharacteristic(C.TargetHeaterCoolerState).updateValue(C.TargetHeaterCoolerState.HEAT);
    this.heater
      .getCharacteristic(C.TargetHeaterCoolerState)
      .setProps({ validValues: [C.TargetHeaterCoolerState.HEAT] })
      .onGet(() => C.TargetHeaterCoolerState.HEAT)
      .onSet(() => undefined);
    this.heater
      .getCharacteristic(C.CurrentTemperature)
      .setProps({ minValue: -40, maxValue: 100, minStep: 0.1 })
      .onGet(() => clamp(this.current().temperatureC, -40, 100));
    this.heater
      .getCharacteristic(C.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(() => levelToPercent(this.current().height, FLAME_LEVELS))
      .onSet((v) => this.heaterWrites.write('flame', Number(v)));

    // A heater must include HeatingThresholdTemperature, so publish it unconditionally rather than
    // withholding it from a unit with no thermostat; such a unit refuses writes instead.
    // The characteristic defaults to 0 °C, below our minimum, so give it a legal value before
    // tightening the props.
    const setpoint = this.heater.getCharacteristic(C.HeatingThresholdTemperature);
    setpoint.updateValue(clamp(initial?.setpointC ?? 22, SETPOINT_MIN_C, SETPOINT_MAX_C));
    setpoint
      .setProps({ minValue: SETPOINT_MIN_C, maxValue: SETPOINT_MAX_C, minStep: 0.5 })
      .onGet(() => clamp(this.current().setpointC, SETPOINT_MIN_C, SETPOINT_MAX_C))
      .onSet((v) => this.heaterWrites.write('setpoint', Number(v)));

    if (deps.exposeBlower && (initial?.hasFan ?? false)) {
      this.blower = ensureService(deps.api, accessory, S.Fanv2, `${accessory.displayName} Blower`, 'blower');
      keep.add(this.blower);
      this.blower
        .getCharacteristic(C.Active)
        .onGet(() => (this.current().fanspeed > 0 ? C.Active.ACTIVE : C.Active.INACTIVE))
        .onSet((v) => this.blowerWrites.write('active', Number(v)));
      this.blower
        .getCharacteristic(C.RotationSpeed)
        .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
        .onGet(() => levelToPercent(this.current().fanspeed, FAN_LEVELS))
        .onSet((v) => this.blowerWrites.write('speed', Number(v)));
    }

    if (deps.exposeLight && (initial?.hasLight ?? false)) {
      this.light = ensureService(deps.api, accessory, S.Lightbulb, `${accessory.displayName} Light`, 'light');
      keep.add(this.light);
      this.light
        .getCharacteristic(C.On)
        .onGet(() => this.current().light > 0)
        .onSet((v) => (v ? this.send('light', Math.max(1, this.current().light)) : this.send('light', 0)));
      this.light
        .getCharacteristic(C.Brightness)
        .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
        .onGet(() => levelToPercent(this.current().light, LIGHT_LEVELS))
        .onSet((v) => this.send('light', percentToLevel(Number(v), LIGHT_LEVELS)));
    }

    if (deps.exposeSwitch) {
      this.sw = ensureService(deps.api, accessory, S.Switch, `${accessory.displayName} Power`, 'power');
      keep.add(this.sw);
      this.sw
        .getCharacteristic(C.On)
        .onGet(() => this.current().power)
        .onSet((v) => this.send('power', v ? 1 : 0));
    }

    pruneServices(accessory, keep, deps.log);
    if (initial) this.push(initial);
    this.poller = new Poller(() => this.refresh(), { intervalMs: deps.pollIntervalMs, log: deps.log, name: 'poll' });
    this.poller.start();
  }

  dispose(): void {
    this.poller.stop();
  }

  get lastState(): FireplaceState | undefined {
    return this.state;
  }

  private current(): FireplaceState {
    if (!this.state || this.poller.consecutiveFailures >= 3) throw commFailure(this.deps.api);
    return this.state;
  }

  private currentHeaterState(s: FireplaceState): number {
    const C = this.deps.api.hap.Characteristic;
    if (!s.power) return C.CurrentHeaterCoolerState.INACTIVE;
    if (s.thermostat && s.temperatureC >= s.setpointC) return C.CurrentHeaterCoolerState.IDLE;
    return C.CurrentHeaterCoolerState.HEATING;
  }

  private async refresh(): Promise<void> {
    const raw = await this.deps.transport.poll();
    this.push(parseFireplaceState(raw, this.state));
  }

  private async send(command: FireplaceCommand, value: number, expected?: Partial<FireplaceState>): Promise<void> {
    try {
      this.deps.log.info(`→ ${command}=${value} (${this.deps.transport.name})`);
      await this.deps.transport.send(command, value);
    } catch (err) {
      this.deps.log.warn(`${command}=${value} failed: ${errorMessage(err)}`);
      throw commFailure(this.deps.api);
    }
    if (this.state) {
      this.state = { ...this.state, ...(expected ?? optimistic(command, value)) };
      const s = this.state;
      // HAP overwrites the characteristic with the raw written value once the handler returns;
      // re-assert derived/quantized values on the next tick.
      setImmediate(() => this.push(s));
    }
    // The module takes a moment to reflect a command; confirm shortly after.
    setTimeout(() => void this.poller.now(), 1500).unref?.();
  }

  private async applyHeaterWrite(ch: Partial<HeaterWrite>): Promise<void> {
    const C = this.deps.api.hap.Characteristic;
    if (ch.active === C.Active.INACTIVE) {
      await this.send('power', 0);
      return;
    }
    if (ch.active === C.Active.ACTIVE && !this.state?.power) {
      await this.send('power', 1);
    }
    if (ch.flame !== undefined) {
      // Flame height 0 is a real level (lowest flame while on), so plain rounding — not the
      // fan-style "any positive percent is at least level 1" quantization.
      await this.send('height', clamp(Math.round((clamp(ch.flame, 0, 100) / 100) * FLAME_LEVELS), 0, FLAME_LEVELS));
    }
    if (ch.setpoint !== undefined) {
      if (this.state && !this.state.hasThermostat) {
        this.deps.log.warn('setpoint write refused: this fireplace reports no thermostat');
        throw commFailure(this.deps.api);
      }
      const c = clamp(ch.setpoint, SETPOINT_MIN_C, SETPOINT_MAX_C);
      await this.send('setpoint', Math.round(c * 100), { setpointC: Math.round(c * 2) / 2, thermostat: true });
    }
  }

  private async applyBlowerWrite(ch: Partial<BlowerWrite>): Promise<void> {
    const C = this.deps.api.hap.Characteristic;
    if (ch.active === C.Active.INACTIVE || ch.speed === 0) {
      await this.send('fanspeed', 0);
      return;
    }
    if (ch.speed !== undefined && ch.speed > 0) {
      await this.send('fanspeed', percentToLevel(ch.speed, FAN_LEVELS));
      return;
    }
    if (ch.active === C.Active.ACTIVE) {
      await this.send('fanspeed', Math.max(1, this.state?.fanspeed ?? 1));
    }
  }

  /** Update every characteristic from a state snapshot (updateValue, never setValue). */
  private push(s: FireplaceState): void {
    const C = this.deps.api.hap.Characteristic;
    this.state = s;
    this.heater.updateCharacteristic(C.Active, s.power ? C.Active.ACTIVE : C.Active.INACTIVE);
    this.heater.updateCharacteristic(C.CurrentHeaterCoolerState, this.currentHeaterState(s));
    this.heater.updateCharacteristic(C.TargetHeaterCoolerState, C.TargetHeaterCoolerState.HEAT);
    this.heater.updateCharacteristic(C.CurrentTemperature, clamp(s.temperatureC, -40, 100));
    this.heater.updateCharacteristic(C.RotationSpeed, levelToPercent(s.height, FLAME_LEVELS));
    if (this.heater.testCharacteristic(C.HeatingThresholdTemperature)) {
      this.heater.updateCharacteristic(C.HeatingThresholdTemperature, clamp(s.setpointC, SETPOINT_MIN_C, SETPOINT_MAX_C));
    }
    if (this.blower) {
      this.blower.updateCharacteristic(C.Active, s.fanspeed > 0 ? C.Active.ACTIVE : C.Active.INACTIVE);
      this.blower.updateCharacteristic(C.RotationSpeed, levelToPercent(s.fanspeed, FAN_LEVELS));
    }
    if (this.light) {
      this.light.updateCharacteristic(C.On, s.light > 0);
      this.light.updateCharacteristic(C.Brightness, levelToPercent(s.light, LIGHT_LEVELS));
    }
    this.sw?.updateCharacteristic(C.On, s.power);
    if (s.firmware) {
      const info = this.accessory.getService(this.deps.api.hap.Service.AccessoryInformation);
      const fw = info?.getCharacteristic(C.FirmwareRevision);
      if (fw && fw.value === '0.0.0') {
        setAccessoryInfo(this.deps.api, this.accessory, {
          manufacturer: 'Hearth & Home',
          model: String(info?.getCharacteristic(C.Model).value ?? 'IntelliFire fireplace'),
          serialNumber: s.serial || String(info?.getCharacteristic(C.SerialNumber).value ?? ''),
          firmwareRevision: s.firmware,
        });
      }
    }
  }
}

function optimistic(command: FireplaceCommand, value: number): Partial<FireplaceState> {
  switch (command) {
    case 'power':
      return { power: value === 1 };
    case 'height':
      return { height: value };
    case 'fanspeed':
      return { fanspeed: value };
    case 'light':
      return { light: value };
    case 'setpoint':
      return { setpointC: value / 100, thermostat: true };
    case 'pilot':
      return { pilot: value === 1 };
    default:
      return {};
  }
}
