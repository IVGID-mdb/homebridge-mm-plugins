import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformAccessory, PlatformConfig } from 'homebridge';
import { createFakeApi, fakeLog, homekitRead, homekitWrite, waitFor } from '@mm/hb-core/testing';
import type { FakeApi } from '@mm/hb-core/testing';
import { BondPlatform } from '../src/platform.js';
import { FakeBond, RCF119_FAN } from './fake-bond.js';

const FAN_ID = '8f5d3fc47e9c92cd';

describe('MMBond platform with a fake BD-1000', () => {
  let bond: FakeBond;
  let fake: FakeApi;
  let platform: BondPlatform;
  let logs: string[];

  beforeEach(async () => {
    bond = new FakeBond();
    bond.devices.set(FAN_ID, structuredClone(RCF119_FAN));
    await bond.start();
    fake = createFakeApi();
    logs = [];
    const config = {
      platform: 'MMBond',
      name: 'Bond',
      bonds: [{ host: bond.host, token: bond.token }],
      pollIntervalSec: 5,
      push: false,
    } as PlatformConfig;
    platform = new BondPlatform(fakeLog(logs), config, fake.api);
  });

  afterEach(async () => {
    fake.shutdown();
    await bond.stop();
  });

  function fan(): PlatformAccessory {
    expect(fake.registered).toHaveLength(1);
    return fake.registered[0]!;
  }

  const actions = () => bond.actions.map((a) => `${a.action}:${JSON.stringify(a.body)}`);

  it('registers one accessory per Bond device with the right services and no pseudo-switches', async () => {
    await fake.launch(platform);
    const acc = fan();
    const { Service: S, Characteristic: C } = fake.api.hap;
    expect(acc.displayName).toBe('Living Room Ceiling fan');
    expect(acc.getService(S.Fanv2)).toBeDefined();
    expect(acc.getServiceById(S.Lightbulb, 'light')).toBeDefined();
    expect(acc.services.filter((s) => s.UUID === S.Switch.UUID)).toHaveLength(0);
    const info = acc.getService(S.AccessoryInformation)!;
    expect(info.getCharacteristic(C.Manufacturer).value).toBe('Olibra');
    expect(info.getCharacteristic(C.Model).value).toBe('BD-1000 / RCF119v2');
    expect(info.getCharacteristic(C.SerialNumber).value).toBe(`ZZTEST0001-${FAN_ID}`);
    expect(info.getCharacteristic(C.FirmwareRevision).value).toBe('4.34.1');
    // RotationSpeed keeps the HAP-spec 0..100 / step 1 props.
    const rs = acc.getService(S.Fanv2)!.getCharacteristic(C.RotationSpeed);
    expect(rs.props.minValue).toBe(0);
    expect(rs.props.maxValue).toBe(100);
    expect(rs.props.minStep).toBe(1);
  });

  it('reflects initial device state after the first poll', async () => {
    bond.devices.get(FAN_ID)!.state = { power: 1, speed: 2, direction: -1, light: 1 };
    await fake.launch(platform);
    const { Service: S, Characteristic: C } = fake.api.hap;
    const f = fan().getService(S.Fanv2)!;
    await waitFor(() => f.getCharacteristic(C.Active).value === C.Active.ACTIVE);
    expect(f.getCharacteristic(C.RotationSpeed).value).toBe(67);
    expect(f.getCharacteristic(C.RotationDirection).value).toBe(C.RotationDirection.COUNTER_CLOCKWISE);
    expect(fan().getServiceById(S.Lightbulb, 'light')!.getCharacteristic(C.On).value).toBe(true);
    expect(await homekitRead(f, C.RotationSpeed)).toBe(67);
  });

  it('tapping the tile (Active=1 + RotationSpeed together) sends exactly one SetSpeed', async () => {
    await fake.launch(platform);
    const { Service: S, Characteristic: C } = fake.api.hap;
    const f = fan().getService(S.Fanv2)!;
    await waitFor(() => f.getCharacteristic(C.Active).value !== null);
    await Promise.all([homekitWrite(f, C.Active, 1), homekitWrite(f, C.RotationSpeed, 100)]);
    expect(actions()).toEqual(['SetSpeed:{"argument":3}']);
    await waitFor(() => f.getCharacteristic(C.Active).value === C.Active.ACTIVE);
    expect(f.getCharacteristic(C.RotationSpeed).value).toBe(100);
  });

  it('speed 0 % or Active=0 turns the fan off with a single TurnOff', async () => {
    bond.devices.get(FAN_ID)!.state = { power: 1, speed: 3, direction: 1, light: 0 };
    await fake.launch(platform);
    const { Service: S, Characteristic: C } = fake.api.hap;
    const f = fan().getService(S.Fanv2)!;
    await waitFor(() => f.getCharacteristic(C.Active).value === C.Active.ACTIVE);
    await Promise.all([homekitWrite(f, C.Active, 0), homekitWrite(f, C.RotationSpeed, 0)]);
    expect(actions()).toEqual(['TurnOff:{}']);
    await waitFor(() => f.getCharacteristic(C.Active).value === C.Active.INACTIVE);
    expect(f.getCharacteristic(C.RotationSpeed).value).toBe(0);
  });

  it('quantizes arbitrary percentages to the nearest of 3 speeds and snaps the slider', async () => {
    await fake.launch(platform);
    const { Service: S, Characteristic: C } = fake.api.hap;
    const f = fan().getService(S.Fanv2)!;
    await waitFor(() => f.getCharacteristic(C.Active).value !== null);
    await homekitWrite(f, C.RotationSpeed, 40);
    expect(bond.actions.at(-1)).toMatchObject({ action: 'SetSpeed', body: { argument: 1 } });
    await waitFor(() => f.getCharacteristic(C.RotationSpeed).value === 33);
    await homekitWrite(f, C.RotationSpeed, 60);
    expect(bond.actions.at(-1)).toMatchObject({ action: 'SetSpeed', body: { argument: 2 } });
    await waitFor(() => f.getCharacteristic(C.RotationSpeed).value === 67);
  });

  it('direction uses SetDirection with Bond ±1 semantics', async () => {
    await fake.launch(platform);
    const { Service: S, Characteristic: C } = fake.api.hap;
    const f = fan().getService(S.Fanv2)!;
    await waitFor(() => f.getCharacteristic(C.Active).value !== null);
    await homekitWrite(f, C.RotationDirection, C.RotationDirection.COUNTER_CLOCKWISE);
    expect(bond.actions.at(-1)).toMatchObject({ action: 'SetDirection', body: { argument: -1 } });
    await homekitWrite(f, C.RotationDirection, C.RotationDirection.CLOCKWISE);
    expect(bond.actions.at(-1)).toMatchObject({ action: 'SetDirection', body: { argument: 1 } });
  });

  it('light uses explicit TurnLightOn/Off, never toggle', async () => {
    await fake.launch(platform);
    const { Service: S, Characteristic: C } = fake.api.hap;
    const l = fan().getServiceById(S.Lightbulb, 'light')!;
    await waitFor(() => fan().getService(S.Fanv2)!.getCharacteristic(C.Active).value !== null);
    await homekitWrite(l, C.On, true);
    await homekitWrite(l, C.On, true);
    await homekitWrite(l, C.On, false);
    expect(bond.actions.map((a) => a.action)).toEqual(['TurnLightOn', 'TurnLightOn', 'TurnLightOff']);
    expect(l.testCharacteristic(C.Brightness)).toBe(false);
  });

  it('a failed action surfaces as SERVICE_COMMUNICATION_FAILURE and is not retried', async () => {
    await fake.launch(platform);
    const { Service: S, Characteristic: C } = fake.api.hap;
    const f = fan().getService(S.Fanv2)!;
    await waitFor(() => f.getCharacteristic(C.Active).value !== null);
    bond.failWith = 500;
    await expect(homekitWrite(f, C.Active, 1)).rejects.toBe(-70402);
    expect(bond.actions).toHaveLength(0);
  });

  it('removes accessories that are no longer on the Bond and keeps the rest', async () => {
    await fake.launch(platform);
    // Simulate a Homebridge restart with a stale cached accessory from a removed device.
    const fake2 = createFakeApi();
    const stale = new fake2.api.platformAccessory('Living Room Fireplace', platform.uuidFor('ZZTEST0001:deadbeef'));
    stale.context.device = { id: 'deadbeef', info: { type: 'FP', name: 'Fireplace', actions: [] }, properties: {} };
    const config = { platform: 'MMBond', bonds: [{ host: bond.host, token: bond.token }], push: false } as PlatformConfig;
    const p2 = new BondPlatform(fakeLog(), config, fake2.api);
    p2.configureAccessory(stale);
    p2.configureAccessory(fake.registered[0]!);
    await fake2.launch(p2);
    expect(fake2.registered).toHaveLength(0);
    expect(fake2.unregistered.map((a) => a.displayName)).toEqual(['Living Room Fireplace']);
    expect(fake2.updated.map((a) => a.displayName)).toEqual(['Living Room Ceiling fan']);
    fake2.shutdown();
  });

  it('keeps cached accessories when the bridge is unreachable at startup', async () => {
    await fake.launch(platform);
    const fake2 = createFakeApi();
    const config = { platform: 'MMBond', bonds: [{ host: '127.0.0.1:1', token: 'x' }], push: false } as PlatformConfig;
    const logs2: string[] = [];
    const p2 = new BondPlatform(fakeLog(logs2), config, fake2.api);
    p2.configureAccessory(fake.registered[0]!);
    await fake2.launch(p2);
    expect(fake2.unregistered).toHaveLength(0);
    expect(logs2.some((l) => l.includes('unreachable'))).toBe(true);
    fake2.shutdown();
  });

  it('applies BPUP push state without polling', async () => {
    fake.shutdown();
    const fakePush = createFakeApi();
    const config = {
      platform: 'MMBond',
      bonds: [{ host: bond.host, token: bond.token }],
      pollIntervalSec: 3600,
      push: true,
      pushPort: bond.udpPort,
    } as PlatformConfig;
    const p = new BondPlatform(fakeLog(), config, fakePush.api);
    await fakePush.launch(p);
    const { Service: S, Characteristic: C } = fakePush.api.hap;
    const f = fakePush.registered[0]!.getService(S.Fanv2)!;
    await waitFor(() => f.getCharacteristic(C.Active).value === C.Active.INACTIVE);
    // Wait for the fake bridge to have seen our keep-alive so it knows where to push.
    await waitFor(() => bond.subscriberCount > 0);
    bond.pushState(FAN_ID, { power: 1, speed: 3 });
    await waitFor(() => f.getCharacteristic(C.Active).value === C.Active.ACTIVE);
    expect(f.getCharacteristic(C.RotationSpeed).value).toBe(100);
    fakePush.shutdown();
  });
});
