/**
 * Normalized fireplace state. Both the local `/poll` reply (numbers) and the cloud `apppoll`
 * reply (strings) map into this. Field names follow the IntelliFire JSON where sensible.
 */
export interface FireplaceState {
  power: boolean;
  /** Flame height 0..4 (0 is the lowest flame, not off). */
  height: number;
  /** Blower speed 0..4 (0 = off). */
  fanspeed: number;
  /** Accent light 0..3 (0 = off). */
  light: number;
  thermostat: boolean;
  /** Thermostat setpoint in °C. */
  setpointC: number;
  /** Room temperature in °C as reported by the remote/thermostat. */
  temperatureC: number;
  pilot: boolean;
  hot: boolean;
  timerOn: boolean;
  timeRemainingS: number;
  hasFan: boolean;
  hasLight: boolean;
  hasThermostat: boolean;
  errors: number[];
  firmware: string;
  serial: string;
}

export const FLAME_LEVELS = 4; // 0..4
/** Blower speeds on the most commonly documented units. Configurable: some have six. */
export const FAN_LEVELS = 4; // 0..4
/** Upper bound accepted by the command validator, so a six-speed unit is not rejected. */
export const MAX_FAN_LEVELS = 6;
export const LIGHT_LEVELS = 3; // 0..3
export const SETPOINT_MIN_C = 10;
/**
 * Apple caps HeatingThresholdTemperature at 25 °C (77 °F) — Float, Celsius, 0..25 step 0.1 per
 * HomeKitADK HAP/HAPCharacteristicTypes.h, HAP spec R14 section 9.42. An accessory may narrow that
 * range but never widen it, so HomeKit cannot reach the fireplace's full native ceiling of 37 °C.
 * The device-side command range (COMMAND_NAMES.setpoint, up to 3700 centi-°C) is deliberately left
 * wider: a setpoint chosen on the fireplace itself is still reported and honoured.
 */
export const SETPOINT_MAX_C = 25;

export function parseFireplaceState(raw: Record<string, unknown>, prev?: Partial<FireplaceState>): FireplaceState {
  const n = (k: string, fallback: number) => {
    const v = raw[k];
    const num = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(num) ? num : fallback;
  };
  const b = (k: string, fallback: boolean) => {
    const v = raw[k];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
    return fallback;
  };
  const has = (k: string) => raw[k] !== undefined && raw[k] !== null;
  const errors = Array.isArray(raw.errors) ? (raw.errors as unknown[]).map(Number).filter(Number.isFinite) : [];
  const setpointRaw = n('setpoint', (prev?.setpointC ?? 22) * 100);
  return {
    power: b('power', prev?.power ?? false),
    height: clampInt(n('height', prev?.height ?? 0), 0, FLAME_LEVELS),
    fanspeed: clampInt(n('fanspeed', prev?.fanspeed ?? 0), 0, FAN_LEVELS),
    light: clampInt(n('light', prev?.light ?? 0), 0, LIGHT_LEVELS),
    thermostat: b('thermostat', prev?.thermostat ?? false),
    setpointC: Math.round(setpointRaw) / 100,
    temperatureC: n('temperature', prev?.temperatureC ?? 18),
    pilot: b('pilot', prev?.pilot ?? false),
    hot: b('hot', prev?.hot ?? false),
    timerOn: b('timer', prev?.timerOn ?? false),
    timeRemainingS: n('timeremaining', prev?.timeRemainingS ?? 0),
    hasFan: has('feature_fan') ? b('feature_fan', false) : (prev?.hasFan ?? has('fanspeed')),
    hasLight: has('feature_light') ? b('feature_light', false) : (prev?.hasLight ?? has('light')),
    hasThermostat: has('feature_thermostat') ? b('feature_thermostat', false) : (prev?.hasThermostat ?? has('setpoint')),
    errors,
    firmware: String(raw.firmware_version_string ?? raw.firmware_version ?? raw.version ?? prev?.firmware ?? ''),
    serial: String(raw.serial ?? prev?.serial ?? ''),
  };
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Commands, with the differing local/cloud wire names (per intellifire4py). */
export type FireplaceCommand = 'power' | 'height' | 'fanspeed' | 'light' | 'setpoint' | 'pilot' | 'beep';

export const COMMAND_NAMES: Record<FireplaceCommand, { cloud: string; local: string; min: number; max: number }> = {
  power: { cloud: 'power', local: 'power', min: 0, max: 1 },
  height: { cloud: 'height', local: 'flame_height', min: 0, max: FLAME_LEVELS },
  // The reference library documents 0..4, but real units vary and at least one has six speeds,
  // so the hard bound is widened here and the plugin only ever sends within the configured count.
  fanspeed: { cloud: 'fanspeed', local: 'fan_speed', min: 0, max: MAX_FAN_LEVELS },
  light: { cloud: 'light', local: 'light', min: 0, max: LIGHT_LEVELS },
  setpoint: { cloud: 'setpoint', local: 'thermostat_setpoint', min: 0, max: 3700 },
  pilot: { cloud: 'pilot', local: 'pilot', min: 0, max: 1 },
  beep: { cloud: 'beep', local: 'beep', min: 1, max: 1 },
};

export function validateCommand(command: FireplaceCommand, value: number): number {
  const spec = COMMAND_NAMES[command];
  const v = Math.round(value);
  if (!Number.isFinite(v) || v < spec.min || v > spec.max) {
    throw new RangeError(`${command}=${value} outside ${spec.min}..${spec.max}`);
  }
  return v;
}
