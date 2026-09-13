import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformAccessory, PlatformConfig } from 'homebridge';
import { createFakeApi, fakeLog, homekitRead, homekitWrite, waitFor } from '@mm/hb-core/testing';
import type { FakeApi } from '@mm/hb-core/testing';
import { LitterRobotPlatform } from '../src/platform.js';
import { attentionOf, litterIsLow, viewOf } from '../src/robot-state.js';
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
  const quiet = { offline: false, poweredOff: false };

  it('derives the drawer, power and cat facts from Whisker fields', () => {
    expect(viewOf(robot())).toMatchObject({ powered: true, poweredOff: false, cycling: false, catDetected: false, drawerFull: false, drawerRemainingPct: 90 });
    expect(viewOf(robot({ robotStatus: 'ROBOT_CLEAN' })).cycling).toBe(true);
    expect(viewOf(robot({ robotStatus: 'ROBOT_CAT_DETECT' })).catDetected).toBe(true);
    expect(viewOf(robot({ robotCycleState: 'CYCLE_STATE_CAT_DETECT' })).catDetected).toBe(true);
    expect(viewOf(robot({ catDetect: 'CAT_DETECT' })).catDetected).toBe(true);
    expect(viewOf(robot({ unitPowerStatus: 'OFF' })).poweredOff).toBe(true);
    expect(viewOf(robot({ isOnline: false })).online).toBe(false);
    expect(viewOf(robot({ isDFIFull: true, DFILevelPercent: 100 })).drawerRemainingPct).toBe(0);
  });

  it('trusts the robot reported litter state over the ambiguous percentage', () => {
    // 0.62 is a fraction; 45 is already a percentage. Both are "not low" by state.
    expect(viewOf(robot()).litterPct).toBe(62);
    expect(viewOf(robot({ litterLevelPercentage: 45 })).litterPct).toBe(45);
    // The percentage alone cannot distinguish 1 % from full, so the state wins when present.
    expect(litterIsLow(viewOf(robot({ litterLevelPercentage: 0.01, litterLevelState: 'OPTIMAL' })), 15)).toBe(false);
    expect(litterIsLow(viewOf(robot({ litterLevelPercentage: 0.99, litterLevelState: 'LOW' })), 15)).toBe(true);
    // With no state reported, the threshold decides.
    expect(litterIsLow(viewOf(robot({ litterLevelPercentage: 10, litterLevelState: undefined })), 15)).toBe(true);
  });

  it('collects every attention cause, and separates hardware from connectivity', () => {
    expect(attentionOf(viewOf(robot()), quiet, 15).needsAttention).toBe(false);
    expect(attentionOf(viewOf(robot({ globeMotorFaultStatus: 'FAULT_MOTOR_STALL' })), quiet, 15)).toMatchObject({ needsAttention: true, hardwareFault: true });
    expect(attentionOf(viewOf(robot({ isBonnetRemoved: true })), quiet, 15)).toMatchObject({ needsAttention: true, hardwareFault: false });
    expect(attentionOf(viewOf(robot({ isLaserDirty: true })), quiet, 15).hardwareFault).toBe(true);
    // Only counts when a hopper is actually fitted; the not-fitted case is covered separately.
    expect(attentionOf(viewOf(robot({ hopperStatus: 'ENABLED', isHopperRemoved: true })), quiet, 15).needsAttention).toBe(true);
    expect(attentionOf(viewOf(robot({ litterLevelState: 'LOW' })), quiet, 15).reasons).toContain('litter running low');
    // Connectivity causes arrive as sustained flags, not from the payload.
    expect(attentionOf(viewOf(robot()), { offline: true, poweredOff: false }, 15).reasons).toContain('not reporting in');
    expect(attentionOf(viewOf(robot()), { offline: false, poweredOff: true }, 15)).toMatchObject({ needsAttention: true, hardwareFault: false });
    // A motor fault reported as a benign string is not a fault.
    expect(attentionOf(viewOf(robot({ globeMotorFaultStatus: 'FAULT_CLEAR' })), quiet, 15).needsAttention).toBe(false);
  });

  it('fails CLOSED on an unfamiliar cat value, because that predicate gates a rotating globe', () => {
    // Only a positively recognised clear value means the globe is empty.
    expect(viewOf(robot({ catDetect: 'CAT_DETECT_CLEAR' })).catDetected).toBe(false);
    expect(viewOf(robot({ catDetect: '' })).catDetected).toBe(false);
    // Anything else counts as a cat, including a value this code has never seen.
    for (const v of ['CAT_DETECT', 'CAT_SENSED', 'PRESENT', 'detected', 'WHATEVER_NEW_ENUM']) {
      expect(viewOf(robot({ catDetect: v })).catDetected, `catDetect=${v}`).toBe(true);
    }
    // An unfamiliar value is flagged so it can be logged rather than silently trusted.
    expect(viewOf(robot({ catDetect: 'WHATEVER_NEW_ENUM' })).catDetectRecognised).toBe(false);
    expect(viewOf(robot({ catDetect: 'CAT_DETECT_CLEAR' })).catDetectRecognised).toBe(true);
  });

  it('fails OPEN on an unfamiliar motor status, so a healthy robot cannot latch a permanent fault', () => {
    for (const v of ['FAULT_MOTOR_STALL', 'MOTOR_JAM', 'OVERCURRENT']) {
      expect(viewOf(robot({ globeMotorFaultStatus: v })).motorFault, `motor=${v}`).toBe(true);
    }
    for (const v of ['', 'OK', 'NOMINAL', 'MOTOR_OK', 'FAULT_CLEAR', 'SOME_NEW_NOMINAL_STRING']) {
      expect(viewOf(robot({ globeMotorFaultStatus: v })).motorFault, `motor=${v}`).toBe(false);
    }
  });

  it('does not treat a hopper that was never fitted as a fault', () => {
    // No hopper on the account: the robot still reports it removed, which must not raise anything.
    expect(viewOf(robot({ isHopperRemoved: true })).hopperFitted).toBe(false);
    expect(attentionOf(viewOf(robot({ isHopperRemoved: true })), quiet, 15).needsAttention).toBe(false);
    // A hopper that is present and fine is fine.
    expect(attentionOf(viewOf(robot({ hopperStatus: 'ENABLED' })), quiet, 15).needsAttention).toBe(false);
    // A hopper that is present and in trouble is reported.
    expect(attentionOf(viewOf(robot({ hopperStatus: 'ENABLED', isHopperRemoved: true })), quiet, 15).reasons).toContain('litter hopper removed or jammed');
    expect(attentionOf(viewOf(robot({ hopperStatus: 'HOPPER_JAM' })), quiet, 15).reasons).toContain('litter hopper removed or jammed');
    // An unfamiliar but non-fault hopper string does not latch an alert.
    expect(attentionOf(viewOf(robot({ hopperStatus: 'SOME_NEW_STATE' })), quiet, 15).needsAttention).toBe(false);
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
      pollIntervalSec: 3600,
      attentionDebounceMinutes: 0,
      ...extra,
    } as PlatformConfig;
    platform = new LitterRobotPlatform(fakeLog(), config, fake.api);
    await fake.launch(platform);
    expect(fake.registered).toHaveLength(1);
    return fake.registered[0]!;
  }

  function handlerFor(acc: PlatformAccessory): { update(d: unknown): void } {
    return (platform as unknown as { handlers: Map<string, { update(d: unknown): void }> }).handlers.get(acc.UUID)!;
  }

  it('publishes only the four concerns, and prunes the old air purifier model', async () => {
    const acc = await launch();
    const { Service: S, Characteristic: C } = fake.api.hap;
    expect(acc.displayName).toBe("M&M's Kitties");
    const info = acc.getService(S.AccessoryInformation)!;
    expect(info.getCharacteristic(C.Manufacturer).value).toBe('Whisker');
    expect(info.getCharacteristic(C.SerialNumber).value).toBe(SERIAL);

    expect(acc.getServiceById(S.FilterMaintenance, 'drawer')).toBeDefined();
    expect(acc.getServiceById(S.OccupancySensor, 'drawer-alert')).toBeDefined();
    expect(acc.getServiceById(S.Switch, 'reset')).toBeDefined();
    expect(acc.getServiceById(S.OccupancySensor, 'attention')).toBeDefined();
    expect(acc.getServiceById(S.Switch, 'clean')).toBeDefined();

    // Everything the narrowed scope dropped.
    expect(acc.getService(S.AirPurifier)).toBeUndefined();
    expect(acc.getServiceById(S.FilterMaintenance, 'litter')).toBeUndefined();
    expect(acc.getServiceById(S.OccupancySensor, 'cat')).toBeUndefined();
    expect(acc.getServiceById(S.Lightbulb, 'nightlight')).toBeUndefined();
    expect(acc.getService(S.TemperatureSensor)).toBeUndefined();
  });

  it('reports drawer capacity and raises the alert when it is full', async () => {
    const acc = await launch();
    const { Service: S, Characteristic: C } = fake.api.hap;
    const drawer = acc.getServiceById(S.FilterMaintenance, 'drawer')!;
    const alert = acc.getServiceById(S.OccupancySensor, 'drawer-alert')!;
    expect(drawer.getCharacteristic(C.FilterLifeLevel).value).toBe(90);
    expect(drawer.getCharacteristic(C.FilterChangeIndication).value).toBe(C.FilterChangeIndication.FILTER_OK);
    expect(alert.getCharacteristic(C.OccupancyDetected).value).toBe(0);

    handlerFor(acc).update(robot({ isDFIFull: true, DFILevelPercent: 100 }));
    expect(drawer.getCharacteristic(C.FilterLifeLevel).value).toBe(0);
    expect(drawer.getCharacteristic(C.FilterChangeIndication).value).toBe(C.FilterChangeIndication.CHANGE_FILTER);
    expect(alert.getCharacteristic(C.OccupancyDetected).value).toBe(1);
  });

  it('offers the reset on both a switch and the drawer service itself', async () => {
    const acc = await launch();
    const { Service: S, Characteristic: C } = fake.api.hap;
    const sw = acc.getServiceById(S.Switch, 'reset')!;
    await homekitWrite(sw, C.On, true);
    expect(cloud.commands.at(-1)).toMatchObject({ command: 'shortResetPress' });
    await waitFor(() => sw.getCharacteristic(C.On).value === false, 3000);

    const drawer = acc.getServiceById(S.FilterMaintenance, 'drawer')!;
    await homekitWrite(drawer, C.ResetFilterIndication, 1);
    expect(cloud.commands.filter((c) => c.command === 'shortResetPress')).toHaveLength(2);
  });

  it('starts a clean cycle', async () => {
    const acc = await launch();
    const { Service: S, Characteristic: C } = fake.api.hap;
    const clean = acc.getServiceById(S.Switch, 'clean')!;
    await homekitWrite(clean, C.On, true);
    expect(cloud.commands.at(-1)).toMatchObject({ command: 'cleanCycle' });
    await waitFor(() => clean.getCharacteristic(C.On).value === true);
    // The API cannot abort a running cycle, so an off write sends nothing.
    const before = cloud.commands.length;
    await homekitWrite(clean, C.On, false);
    expect(cloud.commands).toHaveLength(before);
  });

  it('REFUSES a clean cycle while the robot reports a cat in the globe', async () => {
    const acc = await launch();
    const { Service: S, Characteristic: C } = fake.api.hap;
    const clean = acc.getServiceById(S.Switch, 'clean')!;
    handlerFor(acc).update(robot({ robotStatus: 'ROBOT_CAT_DETECT' }));
    await expect(homekitWrite(clean, C.On, true)).rejects.toBe(-70403);
    expect(cloud.commands.filter((c) => c.command === 'cleanCycle')).toHaveLength(0);

    // Once the cat leaves, the same write goes through.
    handlerFor(acc).update(robot());
    await homekitWrite(clean, C.On, true);
    expect(cloud.commands.at(-1)).toMatchObject({ command: 'cleanCycle' });
  });

  it('raises Needs Attention for hardware, for a switched-off robot and for silence', async () => {
    const acc = await launch();
    const { Service: S, Characteristic: C } = fake.api.hap;
    const att = acc.getServiceById(S.OccupancySensor, 'attention')!;
    expect(att.getCharacteristic(C.OccupancyDetected).value).toBe(0);

    handlerFor(acc).update(robot({ globeMotorFaultStatus: 'FAULT_MOTOR_STALL' }));
    expect(att.getCharacteristic(C.OccupancyDetected).value).toBe(1);
    expect(att.getCharacteristic(C.StatusFault).value).toBe(C.StatusFault.GENERAL_FAULT);

    // A switched-off robot is not "user intent": a breaker or a knocked plug looks identical.
    handlerFor(acc).update(robot({ unitPowerStatus: 'OFF', robotStatus: 'ROBOT_POWER_OFF' }));
    expect(att.getCharacteristic(C.OccupancyDetected).value).toBe(1);
    expect(att.getCharacteristic(C.StatusFault).value).toBe(C.StatusFault.NO_FAULT);

    // Data the cloud admits is stale counts as not reporting in, even while it claims online.
    handlerFor(acc).update(robot({ lastSeen: new Date(Date.now() - 6 * 3600_000).toISOString() }));
    expect(att.getCharacteristic(C.OccupancyDetected).value).toBe(1);

    handlerFor(acc).update(robot());
    expect(att.getCharacteristic(C.OccupancyDetected).value).toBe(0);
  });

  it('keeps Needs Attention answering while the rest of the accessory reports No Response', async () => {
    const acc = await launch();
    const { Service: S, Characteristic: C } = fake.api.hap;
    const att = acc.getServiceById(S.OccupancySensor, 'attention')!;
    const drawer = acc.getServiceById(S.FilterMaintenance, 'drawer')!;

    cloud.graphqlFailWith = 503;
    const poller = (handlerFor(acc) as unknown as { poller: { now(): Promise<void> } }).poller;
    await poller.now();
    await poller.now();
    await poller.now();

    await expect(homekitRead(drawer, C.FilterLifeLevel)).rejects.toBe(-70402);
    expect(await homekitRead(att, C.OccupancyDetected)).toBe(1);
    expect(await homekitRead(att, C.StatusActive)).toBe(true);
  });

  it('a cloud failure during a command becomes SERVICE_COMMUNICATION_FAILURE', async () => {
    const acc = await launch();
    const { Service: S, Characteristic: C } = fake.api.hap;
    cloud.graphqlFailWith = 503;
    await expect(homekitWrite(acc.getServiceById(S.Switch, 'reset')!, C.On, true)).rejects.toBe(-70402);
  });

  it('keeps the alert up when a switched-off robot then goes silent', async () => {
    const acc = await launch({ attentionDebounceMinutes: 0 });
    const { Service: S, Characteristic: C } = fake.api.hap;
    const att = acc.getServiceById(S.OccupancySensor, 'attention')!;

    handlerFor(acc).update(robot({ unitPowerStatus: 'OFF', robotStatus: 'ROBOT_POWER_OFF' }));
    expect(att.getCharacteristic(C.OccupancyDetected).value).toBe(1);
    // The cause changes from "switched off" to "not reporting in". The alert must not clear while
    // the situation is getting worse, which a second independent clock used to cause.
    handlerFor(acc).update(robot({ unitPowerStatus: 'OFF', robotStatus: 'ROBOT_POWER_OFF', lastSeen: new Date(Date.now() - 6 * 3600_000).toISOString() }));
    expect(att.getCharacteristic(C.OccupancyDetected).value).toBe(1);
  });

  it('does not claim the drawer reading is live while the robot is switched off', async () => {
    const acc = await launch();
    const { Service: S, Characteristic: C } = fake.api.hap;
    const alert = acc.getServiceById(S.OccupancySensor, 'drawer-alert')!;
    expect(alert.getCharacteristic(C.StatusActive).value).toBe(true);
    handlerFor(acc).update(robot({ unitPowerStatus: 'OFF', robotStatus: 'ROBOT_POWER_OFF' }));
    expect(alert.getCharacteristic(C.StatusActive).value).toBe(false);
  });

  it('marks exactly one primary service, asserting both sides', async () => {
    const acc = await launch();
    const { Service: S } = fake.api.hap;
    const primaries = acc.services.filter((s) => s.isPrimaryService).map((s) => s.displayName);
    expect(primaries).toEqual(['Drawer Full']);
    expect(acc.getServiceById(S.FilterMaintenance, 'drawer')!.isPrimaryService).toBe(false);
  });

  it('never fabricates robot state when sending a command', async () => {
    const acc = await launch();
    const { Service: S, Characteristic: C } = fake.api.hap;
    const att = acc.getServiceById(S.OccupancySensor, 'attention')!;
    // A real cause is present, and a command must not erase it by inventing a robotStatus.
    handlerFor(acc).update(robot({ isBonnetRemoved: true }));
    expect(att.getCharacteristic(C.OccupancyDetected).value).toBe(1);
    await homekitWrite(acc.getServiceById(S.Switch, 'reset')!, C.On, true);
    await new Promise((r) => setImmediate(r));
    expect(att.getCharacteristic(C.OccupancyDetected).value).toBe(1);
    // The optimistic acknowledgement still reaches the characteristic the command targets.
    expect(acc.getServiceById(S.FilterMaintenance, 'drawer')!.getCharacteristic(C.FilterLifeLevel).value).toBe(100);
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
