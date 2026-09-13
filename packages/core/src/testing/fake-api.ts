/**
 * A Homebridge `API` stand-in for unit tests that uses the REAL hap-nodejs classes, so every
 * characteristic write in a test goes through HAP's own range/format validation. Only the
 * Homebridge glue (registration bookkeeping, events) is faked.
 */
import { EventEmitter } from 'node:events';
import * as hap from '@homebridge/hap-nodejs';
import type { API, Logging, PlatformAccessory, Service, WithUUID } from 'homebridge';

type Ctx = Record<string, unknown>;

export class FakePlatformAccessory extends EventEmitter {
  readonly _hap: hap.Accessory;
  context: Ctx = {};
  category: number;

  constructor(displayName: string, uuid: string, category?: number) {
    super();
    this._hap = new hap.Accessory(displayName, uuid);
    this.category = category ?? 1;
    if (category) this._hap.category = category;
  }
  get displayName(): string {
    return this._hap.displayName;
  }
  set displayName(v: string) {
    this._hap.displayName = v;
  }
  get UUID(): string {
    return this._hap.UUID;
  }
  get services(): Service[] {
    return this._hap.services as unknown as Service[];
  }
  addService(service: WithUUID<typeof Service> | Service, ...args: unknown[]): Service {
    const add = this._hap.addService as unknown as (...a: unknown[]) => Service;
    return add.call(this._hap, service, ...args);
  }
  removeService(service: Service): void {
    this._hap.removeService(service as never);
  }
  getService(name: string | WithUUID<typeof Service>): Service | undefined {
    return this._hap.getService(name as never) as unknown as Service | undefined;
  }
  getServiceById(uuid: string | WithUUID<typeof Service>, subType: string): Service | undefined {
    return this._hap.getServiceById(uuid as never, subType) as unknown as Service | undefined;
  }
}

export interface FakeApi {
  api: API;
  emitter: EventEmitter;
  registered: PlatformAccessory[];
  unregistered: PlatformAccessory[];
  updated: PlatformAccessory[];
  /** Fire didFinishLaunching and wait for the platform's discovery to settle. */
  launch(platform?: { ready: Promise<void> }): Promise<void>;
  shutdown(): void;
}

export function createFakeApi(): FakeApi {
  const emitter = new EventEmitter();
  const registered: PlatformAccessory[] = [];
  const unregistered: PlatformAccessory[] = [];
  const updated: PlatformAccessory[] = [];
  const api = Object.assign(emitter, {
    version: 2.7,
    serverVersion: '2.4.0',
    hap,
    hapLegacyTypes: {},
    user: { storagePath: () => '/tmp', configPath: () => '/tmp/config.json', persistPath: () => '/tmp' },
    platformAccessory: FakePlatformAccessory as unknown as API['platformAccessory'],
    versionGreaterOrEqual: () => true,
    registerAccessory: () => undefined,
    registerPlatform: () => undefined,
    registerPlatformAccessories: (_p: string, _n: string, accs: PlatformAccessory[]) => {
      registered.push(...accs);
    },
    updatePlatformAccessories: (accs: PlatformAccessory[]) => {
      updated.push(...accs);
    },
    unregisterPlatformAccessories: (_p: string, _n: string, accs: PlatformAccessory[]) => {
      unregistered.push(...accs);
    },
    publishExternalAccessories: () => undefined,
  }) as unknown as API;
  return {
    api,
    emitter,
    registered,
    unregistered,
    updated,
    async launch(platform?: { ready: Promise<void> }) {
      emitter.emit('didFinishLaunching');
      if (platform) {
        await platform.ready;
      }
      // Let any trailing microtasks (handler construction, first poll kick-off) run.
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    },
    shutdown() {
      emitter.emit('shutdown');
    },
  };
}

export function fakeLog(collect?: string[]): Logging {
  const push = (level: string) => (msg: string, ...rest: unknown[]) => {
    collect?.push(`${level}: ${[msg, ...rest].join(' ')}`);
  };
  const log = Object.assign(push('log'), {
    prefix: 'test',
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    log: push('log'),
    success: push('success'),
  });
  return log as unknown as Logging;
}

/** Read a characteristic's current value from a service by characteristic class. */
export function charValue(service: Service, ctor: WithUUID<{ new (): hap.Characteristic }>): unknown {
  return service.getCharacteristic(ctor as never).value;
}

type CharCtor = WithUUID<{ new (): hap.Characteristic }>;

/**
 * Simulate a HomeKit write through HAP's own request path (validation + onSet handler).
 * Rejects with the HapStatusError the handler threw, exactly as a controller would see it.
 */
export async function homekitWrite(service: Service, ctor: CharCtor, value: unknown): Promise<void> {
  const ch = service.getCharacteristic(ctor as never);
  // A real controller write is checked against format, range, step, valid values and maxLen BEFORE
  // any handler runs, and a violation is answered -70410 without the accessory ever seeing it.
  // hap-nodejs skips that check when handleSetRequest is called with no connection, so run it here
  // explicitly; otherwise the harness would be more forgiving than the thing it simulates.
  const validate = (ch as unknown as { validateClientSuppliedValue?: (v: unknown) => unknown })
    .validateClientSuppliedValue;
  if (typeof validate === 'function') {
    validate.call(ch, value);
  }
  await ch.handleSetRequest(value as hap.CharacteristicValue);
}

/** Simulate a HomeKit read (runs onGet handlers through HAP). */
export async function homekitRead(service: Service, ctor: CharCtor): Promise<unknown> {
  const ch = service.getCharacteristic(ctor as never);
  return ch.handleGetRequest();
}

/** Wait until a predicate holds or time out — for async state propagation in tests. */
export async function waitFor(pred: () => boolean, timeoutMs = 2000, stepMs = 10): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
