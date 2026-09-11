import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformConfig, Service } from 'homebridge';
import { createFakeApi, fakeLog, homekitRead, homekitWrite, waitFor } from '@mm/hb-core/testing';
import type { FakeApi } from '@mm/hb-core/testing';
import { ModernFormsPlatform } from '../src/platform.js';
import { parseState } from '../src/mf-api.js';
import { FakeModernFormsFan } from './fake-fan.js';

describe('MMModernForms platform with a fake Wynd fan', () => {
  let dev: FakeModernFormsFan;
  let fake: FakeApi;

  beforeEach(async () => {
    dev = new FakeModernFormsFan();
    await dev.start();
    fake = createFakeApi();
    const config = {
      platform: 'MMModernForms',
      fans: [{ host: dev.host }],
      pollIntervalSec: 3,
    } as PlatformConfig;
    const platform = new ModernFormsPlatform(fakeLog(), config, fake.api);
    await fake.launch(platform);
  });

  afterEach(async () => {
    fake.shutdown();
    await dev.stop();
  });

  function svc(): { fan: Service; light: Service } {
    const { Service: S } = fake.api.hap;
    expect(fake.registered).toHaveLength(1);
    const acc = fake.registered[0]!;
    return { fan: acc.getService(S.Fanv2)!, light: acc.getServiceById(S.Lightbulb, 'light')! };
  }

  it('creates Fanv2 + Lightbulb with device identity and reflects live state', async () => {
    const { Characteristic: C, Service: S } = fake.api.hap;
    const acc = fake.registered[0]!;
    expect(acc.displayName).toBe('Bedroom Fan');
    const info = acc.getService(S.AccessoryInformation)!;
    expect(info.getCharacteristic(C.Manufacturer).value).toBe('Modern Forms');
    expect(info.getCharacteristic(C.Model).value).toBe('Wynd');
    expect(info.getCharacteristic(C.SerialNumber).value).toBe('FC:E8:C0:85:02:34');
    expect(info.getCharacteristic(C.FirmwareRevision).value).toBe('1.3.67');
    const { fan, light } = svc();
    await waitFor(() => fan.getCharacteristic(C.Active).value === C.Active.ACTIVE);
    expect(fan.getCharacteristic(C.RotationSpeed).value).toBe(17); // speed 1 of 6
    expect(fan.getCharacteristic(C.RotationDirection).value).toBe(C.RotationDirection.CLOCKWISE);
    expect(fan.testCharacteristic(C.SwingMode)).toBe(false);
    expect(light.getCharacteristic(C.On).value).toBe(false);
    expect(light.getCharacteristic(C.Brightness).value).toBe(0);
    expect(await homekitRead(fan, C.RotationSpeed)).toBe(17);
  });

  it('coalesces Active + RotationSpeed into one request with the quantized level', async () => {
    const { Characteristic: C } = fake.api.hap;
    const { fan } = svc();
    await waitFor(() => fan.getCharacteristic(C.Active).value !== null);
    await Promise.all([homekitWrite(fan, C.Active, 1), homekitWrite(fan, C.RotationSpeed, 50)]);
    expect(dev.sets).toEqual([{ fanOn: true, fanSpeed: 3 }]);
    await waitFor(() => fan.getCharacteristic(C.RotationSpeed).value === 50);
  });

  it('turns off with a single {fanOn:false} and reports 0 %', async () => {
    const { Characteristic: C } = fake.api.hap;
    const { fan } = svc();
    await waitFor(() => fan.getCharacteristic(C.Active).value === C.Active.ACTIVE);
    await homekitWrite(fan, C.Active, 0);
    expect(dev.sets).toEqual([{ fanOn: false }]);
    expect(fan.getCharacteristic(C.Active).value).toBe(C.Active.INACTIVE);
    expect(fan.getCharacteristic(C.RotationSpeed).value).toBe(0);
  });

  it('maps every 6-speed percent boundary correctly', async () => {
    const { Characteristic: C } = fake.api.hap;
    const { fan } = svc();
    await waitFor(() => fan.getCharacteristic(C.Active).value !== null);
    const cases: Array<[number, number, number]> = [
      [1, 1, 17],
      [17, 1, 17],
      [33, 2, 33],
      [50, 3, 50],
      [67, 4, 67],
      [83, 5, 83],
      [100, 6, 100],
      [90, 5, 83],
      [95, 6, 100],
    ];
    for (const [pct, level, snapped] of cases) {
      dev.sets.length = 0;
      await homekitWrite(fan, C.RotationSpeed, pct);
      expect(dev.sets, `write ${pct}%`).toEqual([{ fanOn: true, fanSpeed: level }]);
      // HAP stores the raw write first; our next-tick re-assert snaps it to the real speed.
      await new Promise((r) => setImmediate(r));
      expect(fan.getCharacteristic(C.RotationSpeed).value, `snap ${pct}%`).toBe(snapped);
    }
  });

  it('direction and light/brightness map to the documented keys', async () => {
    const { Characteristic: C } = fake.api.hap;
    const { fan, light } = svc();
    await waitFor(() => fan.getCharacteristic(C.Active).value !== null);
    await homekitWrite(fan, C.RotationDirection, C.RotationDirection.COUNTER_CLOCKWISE);
    await homekitWrite(light, C.Brightness, 40);
    await homekitWrite(light, C.On, false);
    await homekitWrite(light, C.Brightness, 0);
    expect(dev.sets).toEqual([
      { fanDirection: 'reverse' },
      { lightOn: true, lightBrightness: 40 },
      { lightOn: false },
      { lightOn: false },
    ]);
    expect(fan.getCharacteristic(C.RotationDirection).value).toBe(C.RotationDirection.COUNTER_CLOCKWISE);
  });

  it('breezeAsSwingMode exposes SwingMode ↔ wind', async () => {
    const fake2 = createFakeApi();
    const config = { platform: 'MMModernForms', fans: [{ host: dev.host }], breezeAsSwingMode: true } as PlatformConfig;
    const p2 = new ModernFormsPlatform(fakeLog(), config, fake2.api);
    await fake2.launch(p2);
    const { Characteristic: C, Service: S } = fake2.api.hap;
    const fan = fake2.registered[0]!.getService(S.Fanv2)!;
    await waitFor(() => fan.getCharacteristic(C.Active).value !== null);
    expect(fan.testCharacteristic(C.SwingMode)).toBe(true);
    await homekitWrite(fan, C.SwingMode, C.SwingMode.SWING_ENABLED);
    expect(dev.sets.at(-1)).toEqual({ wind: true });
    fake2.shutdown();
  });

  it('a device error becomes SERVICE_COMMUNICATION_FAILURE', async () => {
    const { Characteristic: C } = fake.api.hap;
    const { fan } = svc();
    await waitFor(() => fan.getCharacteristic(C.Active).value !== null);
    dev.failWith = 503;
    await expect(homekitWrite(fan, C.Active, 0)).rejects.toBe(-70402);
  });

  it('parseState tolerates missing/garbage fields', () => {
    const s = parseState({ fanOn: 1, fanSpeed: 99, fanDirection: 'sideways', lightBrightness: 0 });
    expect(s).toMatchObject({ fanOn: true, fanSpeed: 6, fanDirection: 'forward', lightBrightness: 1, hasLight: false });
  });
});
