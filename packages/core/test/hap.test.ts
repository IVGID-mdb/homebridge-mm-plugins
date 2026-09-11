import { describe, expect, it } from 'vitest';
import { ensureService, pruneServices, sanitizeVersion, setAccessoryInfo } from '../src/hap.js';
import { createFakeApi, FakePlatformAccessory } from '../src/testing/fake-api.js';

describe('hap helpers', () => {
  it('sanitizes firmware strings into x.y.z', () => {
    expect(sanitizeVersion('v4.34.1')).toBe('4.34.1');
    expect(sanitizeVersion('2.3')).toBe('2.3.0');
    expect(sanitizeVersion('01.03.0067')).toBe('1.3.67');
    expect(sanitizeVersion('fw 12')).toBe('12.0.0');
    expect(sanitizeVersion(undefined)).toBe('0.0.0');
    expect(sanitizeVersion('garbage')).toBe('0.0.0');
  });

  it('sets accessory information without leaving HAP defaults', () => {
    const { api } = createFakeApi();
    const acc = new FakePlatformAccessory('Fan', api.hap.uuid.generate('x'));
    setAccessoryInfo(api, acc as never, { manufacturer: 'Olibra', model: 'BD-1000', serialNumber: 'ZZ1', firmwareRevision: 'v4.34.1' });
    const info = acc.getService(api.hap.Service.AccessoryInformation)!;
    expect(info.getCharacteristic(api.hap.Characteristic.Manufacturer).value).toBe('Olibra');
    expect(info.getCharacteristic(api.hap.Characteristic.SerialNumber).value).toBe('ZZ1');
    expect(info.getCharacteristic(api.hap.Characteristic.FirmwareRevision).value).toBe('4.34.1');
  });

  it('ensureService is idempotent by subtype and prunes the rest', () => {
    const { api } = createFakeApi();
    const acc = new FakePlatformAccessory('Fan', api.hap.uuid.generate('y'));
    const fan = ensureService(api, acc as never, api.hap.Service.Fanv2, 'Fan');
    const light = ensureService(api, acc as never, api.hap.Service.Lightbulb, 'Fan Light', 'light');
    const stale = acc.addService(api.hap.Service.Switch, 'Toggle Light State', 'toggle');
    expect(acc.services).toContain(stale);
    expect(ensureService(api, acc as never, api.hap.Service.Fanv2, 'Fan')).toBe(fan);
    expect(ensureService(api, acc as never, api.hap.Service.Lightbulb, 'Fan Light', 'light')).toBe(light);
    pruneServices(acc as never, new Set([fan, light]));
    expect(acc.services).not.toContain(stale);
    expect(acc.services).toContain(fan);
    expect(acc.services).toContain(light);
    expect(acc.getService(api.hap.Service.AccessoryInformation)).toBeDefined();
  });
});
