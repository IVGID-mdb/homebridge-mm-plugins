import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformAccessory, PlatformConfig } from 'homebridge';
import { createFakeApi, fakeLog, homekitWrite, waitFor } from '@mm/hb-core/testing';
import type { FakeApi } from '@mm/hb-core/testing';
import { IntellifirePlatform } from '../src/platform.js';
import { FakeFireplaceModule, FakeIftCloud, SERIAL } from './fake-intellifire.js';

describe('MMIntellifire platform (local-first with cloud fallback)', () => {
  let mod: FakeFireplaceModule;
  let cloud: FakeIftCloud;
  let fake: FakeApi;
  let platform: IntellifirePlatform;
  let logs: string[];

  function config(extra: Record<string, unknown> = {}): PlatformConfig {
    return {
      platform: 'MMIntellifire',
      username: cloud.username,
      password: cloud.password,
      cloudBaseUrl: cloud.baseUrl,
      discoveryPort: mod.udpPort,
      discoveryTimeoutMs: 300,
      localPollIntervalSec: 2,
      cloudPollIntervalSec: 15,
      ...extra,
    } as PlatformConfig;
  }

  beforeEach(async () => {
    mod = new FakeFireplaceModule();
    await mod.start();
    cloud = new FakeIftCloud(mod);
    await cloud.start();
    fake = createFakeApi();
    logs = [];
  });

  afterEach(async () => {
    fake.shutdown();
    await cloud.stop();
    await mod.stop();
  });

  async function launch(extra: Record<string, unknown> = {}): Promise<PlatformAccessory> {
    platform = new IntellifirePlatform(fakeLog(logs), config(extra), fake.api);
    // Discovery broadcasts to 255.255.255.255 by default; the fake listens on loopback only,
    // so pin the override IP the way a user with a DHCP reservation would.
    await fake.launch(platform);
    expect(fake.registered).toHaveLength(1);
    return fake.registered[0]!;
  }

  it('discovers via cloud login, primes state, and builds a HeaterCooler with blower + light', async () => {
    const acc = await launch({ fireplaces: [{ ip: mod.host }] });
    const { Service: S, Characteristic: C } = fake.api.hap;
    expect(acc.displayName).toBe('Living Room');
    const info = acc.getService(S.AccessoryInformation)!;
    expect(info.getCharacteristic(C.Manufacturer).value).toBe('Hearth & Home');
    expect(info.getCharacteristic(C.SerialNumber).value).toBe(SERIAL);
    const h = acc.getService(S.HeaterCooler)!;
    expect(h).toBeDefined();
    expect(acc.getServiceById(S.Fanv2, 'blower')).toBeDefined();
    expect(acc.getServiceById(S.Lightbulb, 'light')).toBeDefined();
    expect(acc.getServiceById(S.Switch, 'power')).toBeUndefined();
    expect(h.getCharacteristic(C.TargetHeaterCoolerState).props.validValues).toEqual([C.TargetHeaterCoolerState.HEAT]);
    expect(h.getCharacteristic(C.Active).value).toBe(C.Active.INACTIVE);
    expect(h.getCharacteristic(C.CurrentTemperature).value).toBe(21);
    expect(h.getCharacteristic(C.HeatingThresholdTemperature).value).toBe(22);
    expect(h.getCharacteristic(C.RotationSpeed).value).toBe(50); // height 2 of 4
    expect(h.getCharacteristic(C.CurrentHeaterCoolerState).value).toBe(C.CurrentHeaterCoolerState.INACTIVE);
    expect(logs.some((l) => l.includes('control path: auto'))).toBe(true);
    expect(cloud.logins).toBe(1);
  });

  it('turns on, sets flame and setpoint over the LAN with signed commands', async () => {
    const acc = await launch({ fireplaces: [{ ip: mod.host }] });
    const { Service: S, Characteristic: C } = fake.api.hap;
    const h = acc.getService(S.HeaterCooler)!;
    await Promise.all([homekitWrite(h, C.Active, 1), homekitWrite(h, C.RotationSpeed, 100)]);
    expect(mod.commands.map((c) => `${c.command}=${c.value}`)).toEqual(['power=1', 'flame_height=4']);
    expect(cloud.posts).toHaveLength(0);
    await waitFor(() => h.getCharacteristic(C.CurrentHeaterCoolerState).value === C.CurrentHeaterCoolerState.HEATING);
    await homekitWrite(h, C.HeatingThresholdTemperature, 23.5);
    expect(mod.commands.at(-1)).toMatchObject({ command: 'thermostat_setpoint', value: '2350' });
    await homekitWrite(h, C.RotationSpeed, 10);
    expect(mod.commands.at(-1)).toMatchObject({ command: 'flame_height', value: '0' });
    await new Promise((r) => setImmediate(r));
    expect(h.getCharacteristic(C.RotationSpeed).value).toBe(0);
    await homekitWrite(h, C.Active, 0);
    expect(mod.commands.at(-1)).toMatchObject({ command: 'power', value: '0' });
  });

  it('blower and accent light map to fan_speed and light levels', async () => {
    const acc = await launch({ fireplaces: [{ ip: mod.host }] });
    const { Service: S, Characteristic: C } = fake.api.hap;
    const blower = acc.getServiceById(S.Fanv2, 'blower')!;
    const light = acc.getServiceById(S.Lightbulb, 'light')!;
    await Promise.all([homekitWrite(blower, C.Active, 1), homekitWrite(blower, C.RotationSpeed, 75)]);
    expect(mod.commands.at(-1)).toMatchObject({ command: 'fan_speed', value: '3' });
    await homekitWrite(blower, C.Active, 0);
    expect(mod.commands.at(-1)).toMatchObject({ command: 'fan_speed', value: '0' });
    await homekitWrite(light, C.Brightness, 100);
    expect(mod.commands.at(-1)).toMatchObject({ command: 'light', value: '3' });
    await homekitWrite(light, C.On, false);
    expect(mod.commands.at(-1)).toMatchObject({ command: 'light', value: '0' });
  });

  it('falls back to the cloud when the module drops off the LAN, then returns to local', async () => {
    const acc = await launch({ fireplaces: [{ ip: mod.host }] });
    const { Service: S, Characteristic: C } = fake.api.hap;
    const h = acc.getService(S.HeaterCooler)!;
    mod.offline = true;
    await homekitWrite(h, C.Active, 1);
    // First local failure → immediate cloud fallback for this command.
    expect(cloud.posts.at(-1)).toEqual({ serial: SERIAL, body: 'power=1' });
    expect(mod.state.power).toBe(1);
    mod.offline = false;
    await homekitWrite(h, C.Active, 0);
    // Local had only one failure, so it is still preferred.
    expect(mod.commands.at(-1)).toMatchObject({ command: 'power', value: '0' });
  });

  it('cloud-only mode never touches the LAN', async () => {
    const acc = await launch({ mode: 'cloud' });
    const { Service: S, Characteristic: C } = fake.api.hap;
    const h = acc.getService(S.HeaterCooler)!;
    expect(logs.some((l) => l.includes('control path: cloud'))).toBe(true);
    await homekitWrite(h, C.Active, 1);
    expect(cloud.posts).toEqual([{ serial: SERIAL, body: 'power=1' }]);
    expect(mod.commands).toHaveLength(0);
  });

  it('reuses pre-issued cookies without logging in, and keeps cached fireplaces when the cloud is down', async () => {
    await launch({ username: undefined, password: undefined, ...cloud.cookies, fireplaces: [{ ip: mod.host }] });
    expect(cloud.logins).toBe(0);
    const registered = fake.registered[0]!;
    // Restart with the cloud unreachable: the cached context (serial/apikey/ip/user) must suffice.
    const fake2 = createFakeApi();
    const p2 = new IntellifirePlatform(fakeLog(), config({ cloudBaseUrl: 'http://127.0.0.1:1', fireplaces: [{ ip: mod.host }] }), fake2.api);
    p2.configureAccessory(registered);
    await fake2.launch(p2);
    expect(fake2.unregistered).toHaveLength(0);
    const { Service: S, Characteristic: C } = fake2.api.hap;
    const h = registered.getService(S.HeaterCooler)!;
    await homekitWrite(h, C.Active, 1);
    expect(mod.commands.at(-1)).toMatchObject({ command: 'power', value: '1' });
    fake2.shutdown();
  });

  it('optional plain Switch mirrors power when enabled', async () => {
    const acc = await launch({ fireplaces: [{ ip: mod.host }], exposeSwitch: true });
    const { Service: S, Characteristic: C } = fake.api.hap;
    const sw = acc.getServiceById(S.Switch, 'power')!;
    expect(sw).toBeDefined();
    await homekitWrite(sw, C.On, true);
    expect(mod.commands.at(-1)).toMatchObject({ command: 'power', value: '1' });
    await waitFor(() => acc.getService(S.HeaterCooler)!.getCharacteristic(C.Active).value === C.Active.ACTIVE);
  });

});
