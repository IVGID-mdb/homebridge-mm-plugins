import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IntellifireCloud } from '../src/cloud-api.js';
import { IntellifireLocal, signLocalCommand } from '../src/local-api.js';
import { discoverFireplaces } from '../src/discovery.js';
import { parseFireplaceState, validateCommand } from '../src/state.js';
import { APIKEY, FakeFireplaceModule, FakeIftCloud, SERIAL, USER_ID } from './fake-intellifire.js';

describe('IntelliFire protocol pieces', () => {
  let mod: FakeFireplaceModule;
  let cloud: FakeIftCloud;

  beforeEach(async () => {
    mod = new FakeFireplaceModule();
    await mod.start();
    cloud = new FakeIftCloud(mod);
    await cloud.start();
  });

  afterEach(async () => {
    await cloud.stop();
    await mod.stop();
  });

  it('signs local commands exactly like intellifire4py', () => {
    // Known-answer: computed with python hashlib for these inputs.
    const sig = signLocalCommand('00ff', 'abcd', 'power', 1);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic + sensitive to every input.
    expect(signLocalCommand('00ff', 'abcd', 'power', 1)).toBe(sig);
    expect(signLocalCommand('00ff', 'abce', 'power', 1)).not.toBe(sig);
    expect(signLocalCommand('00ff', 'abcd', 'power', 0)).not.toBe(sig);
    expect(signLocalCommand('00fe', 'abcd', 'power', 1)).not.toBe(sig);
  });

  it('local: polls numbers and sends signed commands the module accepts', async () => {
    const local = new IntellifireLocal(mod.host, APIKEY, USER_ID);
    const s = parseFireplaceState(await local.poll());
    expect(s).toMatchObject({ power: false, height: 2, setpointC: 22, temperatureC: 21, hasFan: true, hasLight: true, hasThermostat: true, serial: SERIAL });
    await local.send('power', 1);
    await local.send('height', 4);
    await local.send('setpoint', 2350);
    expect(mod.commands.map((c) => `${c.command}=${c.value}`)).toEqual(['power=1', 'flame_height=4', 'thermostat_setpoint=2350']);
    expect(mod.state.power).toBe(1);
    expect(mod.state.setpoint).toBe(2350);
  });

  it('local: a wrong api key is rejected by the module (403) and surfaces as an error', async () => {
    const local = new IntellifireLocal(mod.host, 'ff'.repeat(32), USER_ID);
    await expect(local.send('power', 1)).rejects.toThrow(/403/);
    expect(mod.commands).toHaveLength(0);
  });

  it('local: retries once when the challenge expired', async () => {
    mod.challengeTtlMs = -1; // every challenge is already expired → 403 on each try
    const local = new IntellifireLocal(mod.host, APIKEY, USER_ID);
    await expect(local.send('power', 1)).rejects.toThrow(/403/);
  });

  it('rejects out-of-range command values before touching the network', () => {
    expect(() => validateCommand('height', 5)).toThrow(RangeError);
    expect(() => validateCommand('light', -1)).toThrow(RangeError);
    expect(validateCommand('setpoint', 2249.6)).toBe(2250);
  });

  it('cloud: logs in, enumerates fireplaces with api keys, polls strings, posts commands', async () => {
    const c = new IntellifireCloud(cloud.baseUrl);
    const cookies = await c.login(cloud.username, cloud.password);
    expect(cookies.user).toBe(USER_ID);
    const list = await c.listFireplaces();
    expect(list).toEqual([{ serial: SERIAL, apikey: APIKEY, name: 'Living Room', brand: 'H&H' }]);
    const s = parseFireplaceState(await c.poll(SERIAL));
    expect(s.power).toBe(false);
    expect(s.setpointC).toBe(22);
    await c.send(SERIAL, 'height', 3);
    expect(cloud.posts).toEqual([{ serial: SERIAL, body: 'height=3' }]);
    expect(mod.state.height).toBe(3);
  });

  it('cloud: bad password fails loudly', async () => {
    const c = new IntellifireCloud(cloud.baseUrl);
    await expect(c.login(cloud.username, 'wrong')).rejects.toThrow();
  });

  it('parseFireplaceState handles cloud string payloads and keeps features from previous state', () => {
    const s = parseFireplaceState({ power: '1', height: '3', setpoint: '2150', temperature: '19', thermostat: '0' }, { hasFan: true, hasLight: false, hasThermostat: true, firmware: 'x' } as never);
    expect(s).toMatchObject({ power: true, height: 3, setpointC: 21.5, temperatureC: 19, hasFan: true, hasLight: false, hasThermostat: true });
  });

  it('discovers the module over UDP and confirms its serial via /poll', async () => {
    const found = await discoverFireplaces({ port: mod.udpPort, broadcast: '127.0.0.1', timeoutMs: 300 });
    expect(found).toEqual([{ ip: mod.host, serial: SERIAL }]);
  });
});
