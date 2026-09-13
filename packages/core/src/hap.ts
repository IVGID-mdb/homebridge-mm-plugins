import type { API, PlatformAccessory, Service, WithUUID } from 'homebridge';

/** The HAP error that makes the Home app show "No Response" instead of a stale value. */
export function commFailure(api: API): Error {
  return new api.hap.HapStatusError(api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
}

export interface AccessoryInfo {
  manufacturer: string;
  model: string;
  serialNumber: string;
  firmwareRevision?: string;
  hardwareRevision?: string;
}

/**
 * Populate the mandatory AccessoryInformation service, never leaving HAP defaults.
 *
 * Apple validates these strings by BYTE length, not character count: manufacturer and name at
 * most 64, model 1..64, serial number 2..64 (HomeKitADK HAP/HAPAccessoryValidation.c:13-58).
 * hap-nodejs separately discards any string only one character long, so an unclamped 1-character
 * serial would silently never reach HomeKit.
 */
export function setAccessoryInfo(api: API, accessory: PlatformAccessory, info: AccessoryInfo): void {
  const { Service: S, Characteristic: C } = api.hap;
  const svc = accessory.getService(S.AccessoryInformation) ?? accessory.addService(S.AccessoryInformation);
  svc
    .setCharacteristic(C.Manufacturer, clampBytes(info.manufacturer, 1, 64, 'Unknown'))
    .setCharacteristic(C.Model, clampBytes(info.model, 1, 64, 'Unknown'))
    .setCharacteristic(C.SerialNumber, clampBytes(info.serialNumber, 2, 64, accessory.UUID))
    .setCharacteristic(C.FirmwareRevision, sanitizeVersion(info.firmwareRevision));
  if (info.hardwareRevision) {
    svc.setCharacteristic(C.HardwareRevision, clampBytes(info.hardwareRevision, 1, 64, '1.0.0'));
  }
}

/**
 * Trim a string into Apple's validated byte envelope, substituting the fallback when the value is
 * too short to be legal. Truncation stops on a code-point boundary so a multi-byte character is
 * never cut in half.
 */
export function clampBytes(value: string | undefined, min: number, max: number, fallback: string): string {
  const v = (value ?? '').trim();
  const size = (s: string) => Buffer.byteLength(s, 'utf8');
  if (size(v) < min) return fallback;
  if (size(v) <= max) return v;
  let out = '';
  for (const ch of v) {
    if (size(out + ch) > max) break;
    out += ch;
  }
  return size(out) >= min ? out : fallback;
}

/** HAP requires FirmwareRevision to look like "x.y.z"; devices report all sorts of strings. */
export function sanitizeVersion(v: string | undefined): string {
  if (!v) return '0.0.0';
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v);
  if (!m) return '0.0.0';
  return `${Number(m[1])}.${Number(m[2] ?? '0')}.${Number(m[3] ?? '0')}`;
}

export interface EnsureServiceOptions {
  /** Distinguishes several services of the same type on one accessory. */
  subtype?: string;
  /**
   * Mark this as the accessory's primary service. HAP allows at most one per accessory, and the
   * helper does not police that across calls, so set it on exactly one service per accessory.
   */
  primary?: boolean;
}

/**
 * Get-or-add a service by class + subtype. Homebridge restores cached services by UUID+subtype,
 * so always addressing them this way keeps HomeKit automations bound across restarts.
 * The Name characteristic is what Siri and the Home app use for the tile.
 *
 * The fifth argument accepts either a bare subtype string (the common case) or an options object.
 */
export function ensureService(
  api: API,
  accessory: PlatformAccessory,
  ctor: WithUUID<typeof Service>,
  displayName: string,
  subtypeOrOptions?: string | EnsureServiceOptions,
): Service {
  const opts: EnsureServiceOptions =
    typeof subtypeOrOptions === 'string' ? { subtype: subtypeOrOptions } : (subtypeOrOptions ?? {});
  const { subtype } = opts;
  const existing = subtype ? accessory.getServiceById(ctor, subtype) : accessory.getService(ctor);
  // All concrete HAP services take (displayName?, subtype?); the generic typing follows the base
  // Service ctor (displayName, UUID, subtype) so we narrow the call shape here, once.
  const add = accessory.addService.bind(accessory) as unknown as (c: unknown, name: string, sub?: string) => Service;
  const svc = existing ?? (subtype ? add(ctor, displayName, subtype) : add(ctor, displayName));
  svc.setCharacteristic(api.hap.Characteristic.Name, displayName);
  // ConfiguredName is what iOS 16+ shows/edits; keep it consistent so renames in config win.
  if (svc.testCharacteristic(api.hap.Characteristic.ConfiguredName)) {
    svc.updateCharacteristic(api.hap.Characteristic.ConfiguredName, displayName);
  }
  if (opts.primary !== undefined) {
    svc.setPrimaryService(opts.primary);
  }
  return svc;
}

const ACCESSORY_INFORMATION_UUID = '0000003E-0000-1000-8000-0026BB765291';
const PROTOCOL_INFORMATION_UUID = '000000A2-0000-1000-8000-0026BB765291';

/** Remove services on a cached accessory that the current build no longer creates. */
export function pruneServices(
  accessory: PlatformAccessory,
  keep: ReadonlySet<Service>,
  log?: { info(msg: string): void },
): void {
  for (const svc of [...accessory.services]) {
    if (svc.UUID === ACCESSORY_INFORMATION_UUID || svc.UUID === PROTOCOL_INFORMATION_UUID) continue;
    if (!keep.has(svc)) {
      log?.info(`Removing obsolete service "${svc.displayName}" (${svc.UUID}${svc.subtype ? '/' + svc.subtype : ''})`);
      accessory.removeService(svc);
    }
  }
}
