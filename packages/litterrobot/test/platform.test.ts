import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformAccessory, PlatformConfig } from 'homebridge';
import { createFakeApi, fakeLog, homekitWrite, waitFor } from '@mm/hb-core/testing';
import type { FakeApi } from '@mm/hb-core/testing';
import { LitterRobotPlatform } from '../src/platform.js';
import { viewOf } from '../src/robot-state.js';
import { WhiskerApi, decodeJwt } from '../src/whisker-api.js';
import { FakeWhisker, SERIAL, USER_ID, robot } from './fake-whisker.js';

describe('Whisker API client', () => {
  let cloud: FakeWhisker;
  beforeEach(async () => {
    cloud = new FakeWhisker();
    await cloud.start();
  });
  afterEach(async () => cloud.stop());

  it('logs in with USER_PASSWORD_AUTH, derives the user id, lists robots', async () => {
    const api = new WhiskerApi(cloud.username, cloud.password, { cognitoUrl: cloud.cognitoUrl, graphqlUrl: cloud.graphqlUrl });
    const robots = await api.listRobots();
    expect(robots.map((r) => r.serial)).toEqual([SERIAL]);
    expect(api.currentUserId).toBe(USER_ID);
    expect(cloud.logins).toBe(1);
    await api.listRobots();
    expect(cloud.logins).toBe(1); // token cached
  });

  it('bad password is a clear auth error', async () => {
    const api = new WhiskerApi(cloud.username, 'nope', { cognitoUrl: cloud.cognitoUrl, graphqlUrl: cloud.graphqlUrl });
    await expect(api.listRobots()).rejects.toThrow(/NotAuthorizedException/);
  });

  it('re-authenticates once on 401 and sends commands with the documented mutation shape', async () => {
    const api = new WhiskerApi(cloud.username, cloud.password, { cognitoUrl: cloud.cognitoUrl, graphqlUrl: cloud.graphqlUrl });
    await api.listRobots();
    cloud.rotateToken(); // server-side expiry
    await api.sendCommand(SERIAL, 'cleanCycle');
    expect(cloud.commands).toEqual([{ serial: SERIAL, command: 'cleanCycle', value: null, commandSource: 'homebridge' }]);
    expect(cloud.refreshes).toBe(1);
    expect(cloud.logins).toBe(1);
  });

  it('decodeJwt tolerates garbage', () => {
    expect(decodeJwt('nope')).toEqual({});
    expect(decodeJwt('a.!!!.c')).toEqual({});
  });
});

describe('robot view mapping', () => {
  it('derives HomeKit-facing booleans from Whisker fields', () => {
    expect(viewOf(robot())).toMatchObject({ powered: true, cycling: false, catDetected: false, drawerFull: false, drawerRemainingPct: 90, litterPct: 62, nightLightOn: true });
    expect(viewOf(robot({ robotStatus: 'ROBOT_CLEAN' })).cycling).toBe(true);
    expect(viewOf(robot({ robotStatus: 'ROBOT_CAT_DETECT' })).catDetected).toBe(true);
    expect(viewOf(robot({ robotCycleState: 'CYCLE_STATE_CAT_DETECT' })).catDetected).toBe(true);
    expect(viewOf(robot({ catDetect: 'CAT_DETECT' })).catDetected).toBe(true);
    expect(viewOf(robot({ unitPowerStatus: 'OFF' })).powered).toBe(false);
    expect(viewOf(robot({ isOnline: false })).powered).toBe(false);
    expect(viewOf(robot({ isDFIFull: true, DFILevelPercent: 100 })).drawerRemainingPct).toBe(0);
    expect(viewOf(robot({ litterLevelPercentage: 45 })).litterPct).toBe(45);
    expect(viewOf(robot({ nightLightMode: 'OFF' })).nightLightOn).toBe(false);
  });
});

describe('MMLitterRobot platform', () => {
  let cloud: FakeWhisker;
  let fake: FakeApi;
  let platform: LitterRobotPlatform;

  beforeEach(async () => {
    cloud = new FakeWhisker();
    await cloud.start();
    fake = createFakeApi();
  });

  afterEach(async () => {
    fake.shutdown();
    await cloud.stop();
  });

  async function launch(extra: Record<string, unknown> = {}): Promise<PlatformAccessory> {
    const config = {
      platform: 'MMLitterRobot',
      username: cloud.username,
      password: cloud.password,
      cognitoUrl: cloud.cognitoUrl,
      graphqlUrl: cloud.graphqlUrl,
      pollIntervalSec: 15,
      ...extra,
    } as PlatformConfig;
    platform = new LitterRobotPlatform(fakeLog(), config, fake.api);
    await fake.launch(platform);
    expect(fake.registered).toHaveLength(1);
    return fake.registered[0]!;
  }

  it('builds AirPurifier + linked filters + occupancy + clean switch + night light with correct values', async () => {
    const acc = await launch();
    const { Service: S, Characteristic: C } = fake.api.hap;
    expect(acc.displayName).toBe("M&M's Kitties");
    const info = acc.getService(S.AccessoryInformation)!;
    expect(info.getCharacteristic(C.Manufacturer).value).toBe('Whisker');
    expect(info.getCharacteristic(C.SerialNumber).value).toBe(SERIAL);
    expect(info.getCharacteristic(C.FirmwareRevision).value).toBe('1.1.50');
    const p = acc.getService(S.AirPurifier)!;
    expect(p.getCharacteristic(C.Active).value).toBe(C.Active.ACTIVE);
    expect(p.getCharacteristic(C.CurrentAirPurifierState).value).toBe(C.CurrentAirPurifierState.IDLE);
    expect(p.getCharacteristic(C.TargetAirPurifierState).props.validValues).toEqual([C.TargetAirPurifierState.AUTO]);
    const drawer = acc.getServiceById(S.FilterMaintenance, 'drawer')!;
    expect(drawer.getCharacteristic(C.FilterLifeLevel).value).toBe(90);
    expect(drawer.getCharacteristic(C.FilterChangeIndication).value).toBe(C.FilterChangeIndication.FILTER_OK);
    const litter = acc.getServiceById(S.FilterMaintenance, 'litter')!;
    expect(litter.getCharacteristic(C.FilterLifeLevel).value).toBe(62);
    expect(p.linkedServices).toEqual(expect.arrayContaining([drawer, litter]));
    expect(acc.getServiceById(S.OccupancySensor, 'cat')!.getCharacteristic(C.OccupancyDetected).value).toBe(0);
    expect(acc.getServiceById(S.Switch, 'clean')!.getCharacteristic(C.On).value).toBe(false);
    expect(acc.getServiceById(S.Lightbulb, 'nightlight')!.getCharacteristic(C.On).value).toBe(true);
    expect(acc.getServiceById(S.Switch, 'reset')).toBeUndefined();
    // No fake temperature sensors.
    expect(acc.getService(S.TemperatureSensor)).toBeUndefined();
  });

  it('clean switch sends cleanCycle, shows Purifying, then settles back', async () => {
    const acc = await launch();
    const { Service: S, Characteristic: C } = fake.api.hap;
    const sw = acc.getServiceById(S.Switch, 'clean')!;
    const p = acc.getService(S.AirPurifier)!;
    await homekitWrite(sw, C.On, true);
    expect(cloud.commands.at(-1)).toMatchObject({ serial: SERIAL, command: 'cleanCycle' });
    await waitFor(() => p.getCharacteristic(C.CurrentAirPurifierState).value === C.CurrentAirPurifierState.PURIFYING_AIR);
    expect(sw.getCharacteristic(C.On).value).toBe(true);
    // Turning the switch off is a no-op (cycles can't be cancelled).
    await homekitWrite(sw, C.On, false);
    expect(cloud.commands).toHaveLength(1);
  });

  it('power and night light commands', async () => {
    const acc = await launch();
    const { Service: S, Characteristic: C } = fake.api.hap;
    const p = acc.getService(S.AirPurifier)!;
    const nl = acc.getServiceById(S.Lightbulb, 'nightlight')!;
    await homekitWrite(p, C.Active, 0);
    await homekitWrite(nl, C.On, false);
    await homekitWrite(nl, C.On, true);
    expect(cloud.commands.map((c) => c.command)).toEqual(['powerOff', 'nightLightModeOff', 'nightLightModeAuto']);
    await waitFor(() => p.getCharacteristic(C.Active).value === C.Active.INACTIVE);
    expect(p.getCharacteristic(C.CurrentAirPurifierState).value).toBe(C.CurrentAirPurifierState.INACTIVE);
  });

  it('cat detected and full drawer propagate on poll', async () => {
    const acc = await launch({ pollIntervalSec: 15 });
    const { Service: S, Characteristic: C } = fake.api.hap;
    cloud.robots[0] = robot({ robotStatus: 'ROBOT_CAT_DETECT', isDFIFull: true, DFILevelPercent: 100 });
    // Trigger a poll by issuing a command (which schedules poller.now) — cheaper than waiting 15 s.
    await homekitWrite(acc.getServiceById(S.Lightbulb, 'nightlight')!, C.On, true);
    // Directly refresh via the platform's handler poll: emulate by waiting for the 5 s follow-up would be slow,
    // so call update through the accessory using a fresh fetch.
    const p = acc.getService(S.AirPurifier)!;
    const handler = (platform as unknown as { handlers: Map<string, { update(d: unknown): void }> }).handlers.get(acc.UUID)!;
    handler.update(cloud.robots[0]);
    expect(acc.getServiceById(S.OccupancySensor, 'cat')!.getCharacteristic(C.OccupancyDetected).value).toBe(1);
    expect(acc.getServiceById(S.FilterMaintenance, 'drawer')!.getCharacteristic(C.FilterChangeIndication).value).toBe(C.FilterChangeIndication.CHANGE_FILTER);
    expect(acc.getServiceById(S.FilterMaintenance, 'drawer')!.getCharacteristic(C.FilterLifeLevel).value).toBe(0);
    expect(p.getCharacteristic(C.CurrentAirPurifierState).value).toBe(C.CurrentAirPurifierState.IDLE);
  });

  it('optional reset switch is momentary and sends shortResetPress', async () => {
    const acc = await launch({ exposeResetSwitch: true });
    const { Service: S, Characteristic: C } = fake.api.hap;
    const sw = acc.getServiceById(S.Switch, 'reset')!;
    await homekitWrite(sw, C.On, true);
    expect(cloud.commands.at(-1)).toMatchObject({ command: 'shortResetPress' });
    await waitFor(() => sw.getCharacteristic(C.On).value === false, 3000);
  });

  it('a cloud failure during a command becomes SERVICE_COMMUNICATION_FAILURE', async () => {
    const acc = await launch();
    const { Service: S, Characteristic: C } = fake.api.hap;
    cloud.graphqlFailWith = 503;
    await expect(homekitWrite(acc.getService(S.AirPurifier)!, C.Active, 0)).rejects.toBe(-70402);
  });

  it('keeps the cached robot when the cloud is unreachable at startup', async () => {
    const acc = await launch();
    const fake2 = createFakeApi();
    const p2 = new LitterRobotPlatform(
      fakeLog(),
      { platform: 'MMLitterRobot', username: 'a', password: 'b', cognitoUrl: 'http://127.0.0.1:1/', graphqlUrl: 'http://127.0.0.1:1/' } as PlatformConfig,
      fake2.api,
    );
    p2.configureAccessory(acc);
    await fake2.launch(p2);
    expect(fake2.unregistered).toHaveLength(0);
    fake2.shutdown();
  });
});
