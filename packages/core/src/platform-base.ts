import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { errorMessage } from './logging.js';

/**
 * How many consecutive successful discovery passes must omit a device before we unregister it.
 * A hub that answers but returns a short list is not proof a device is gone, and HomeKit gives the
 * user no way to restore a single bridged accessory once it is removed.
 */
const STALE_MISSES = 3;

/** What a concrete platform tells the base about each device it found. */
export interface DiscoveredDevice<TContext extends object = object> {
  /** Stable, globally unique seed (serial, MAC, bond id + device id …). Never a display name. */
  uniqueId: string;
  displayName: string;
  /** hap.Categories value shown as the accessory icon before services are inspected. */
  category?: number;
  context: TContext;
}

/** A live handler bound to one accessory. */
export interface AccessoryHandler {
  /** Called on Homebridge shutdown: stop timers, close sockets. */
  dispose(): void;
}

export interface BasePlatformOptions {
  pluginName: string;
  platformName: string;
  /** Remove cached accessories that discovery no longer returns. Default true. */
  removeStale?: boolean;
}

/**
 * Everything a DynamicPlatformPlugin must get right, done once:
 *  - cache restore before registration (no duplicate-UUID errors),
 *  - registration of new devices, restore of existing, pruning of stale,
 *  - UUIDs derived from a stable seed, never from display names,
 *  - disposal on shutdown.
 * Concrete platforms implement discover() and createHandler().
 */
export abstract class BasePlatform<TContext extends object = object> implements DynamicPlatformPlugin {
  protected readonly cached = new Map<string, PlatformAccessory>();
  protected readonly handlers = new Map<string, AccessoryHandler>();
  private launched = false;
  private resolveReady!: () => void;
  /** Resolves once the first discovery pass after didFinishLaunching has completed. */
  readonly ready: Promise<void> = new Promise<void>((r) => (this.resolveReady = r));

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
    protected readonly options: BasePlatformOptions,
  ) {
    api.on('didFinishLaunching', () => {
      this.launched = true;
      void this.runDiscovery().finally(() => this.resolveReady());
    });
    api.on('shutdown', () => {
      for (const h of this.handlers.values()) {
        try {
          h.dispose();
        } catch (err) {
          this.log.debug(`dispose failed: ${errorMessage(err)}`);
        }
      }
      this.handlers.clear();
      this.onShutdown();
    });
  }

  /** Homebridge calls this for every accessory restored from disk, before didFinishLaunching. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug(`Restoring cached accessory: ${accessory.displayName}`);
    this.cached.set(accessory.UUID, accessory);
  }

  /** Find devices. Throwing here keeps the cached accessories untouched (safe on network blips). */
  protected abstract discover(): Promise<Array<DiscoveredDevice<TContext>>>;

  /** Bind services/characteristics to an accessory and return the live handler. */
  protected abstract createHandler(accessory: PlatformAccessory, device: DiscoveredDevice<TContext>): AccessoryHandler;

  /** Optional hook for platform-wide resources (shared sockets etc). */
  protected onShutdown(): void {
    /* no-op */
  }

  uuidFor(uniqueId: string): string {
    return this.api.hap.uuid.generate(`${this.options.pluginName}:${uniqueId}`);
  }

  /** Public so tests (and a future "rescan" button) can drive it. */
  async runDiscovery(): Promise<void> {
    if (!this.launched) return;
    let devices: Array<DiscoveredDevice<TContext>>;
    try {
      devices = await this.discover();
    } catch (err) {
      this.log.error(`Discovery failed, keeping cached accessories as-is: ${errorMessage(err)}`);
      // Still bind handlers to whatever we restored so HomeKit gets "No Response" rather than silence.
      for (const [uuid, accessory] of this.cached) {
        if (!this.handlers.has(uuid) && accessory.context.device) {
          this.bind(accessory, {
            uniqueId: String(accessory.context.uniqueId ?? uuid),
            displayName: accessory.displayName,
            context: accessory.context.device as TContext,
          });
        }
      }
      return;
    }

    const seen = new Set<string>();
    const toRegister: PlatformAccessory[] = [];
    for (const device of devices) {
      const uuid = this.uuidFor(device.uniqueId);
      if (seen.has(uuid)) {
        this.log.warn(`Duplicate device id "${device.uniqueId}" ignored (${device.displayName})`);
        continue;
      }
      seen.add(uuid);
      let accessory = this.cached.get(uuid);
      if (accessory) {
        this.log.info(`Restoring "${device.displayName}"`);
        if (accessory.displayName !== device.displayName) {
          accessory.displayName = device.displayName;
        }
        accessory.context.device = device.context;
        accessory.context.uniqueId = device.uniqueId;
        this.api.updatePlatformAccessories([accessory]);
      } else {
        this.log.info(`Adding "${device.displayName}"`);
        accessory = new this.api.platformAccessory(device.displayName, uuid, device.category);
        accessory.context.device = device.context;
        accessory.context.uniqueId = device.uniqueId;
        this.cached.set(uuid, accessory);
        toRegister.push(accessory);
      }
      this.bind(accessory, device);
    }
    if (toRegister.length) {
      this.api.registerPlatformAccessories(this.options.pluginName, this.options.platformName, toRegister);
    }

    if (this.options.removeStale ?? true) {
      // Require several consecutive misses before destroying an accessory: one short listing from
      // a flaky hub should not cost the user a device they cannot add back themselves.
      const stale: PlatformAccessory[] = [];
      for (const a of this.cached.values()) {
        if (seen.has(a.UUID)) {
          a.context.missCount = 0;
          continue;
        }
        const misses = Number(a.context.missCount ?? 0) + 1;
        a.context.missCount = misses;
        if (misses < STALE_MISSES) {
          this.log.info(`"${a.displayName}" was not discovered (${misses}/${STALE_MISSES}); keeping it for now`);
          continue;
        }
        stale.push(a);
      }
      for (const a of stale) {
        this.log.info(`Removing stale accessory "${a.displayName}" after ${STALE_MISSES} missed discoveries`);
        this.handlers.get(a.UUID)?.dispose();
        this.handlers.delete(a.UUID);
        this.cached.delete(a.UUID);
      }
      if (stale.length) {
        this.api.unregisterPlatformAccessories(this.options.pluginName, this.options.platformName, stale);
      }
    }
  }

  private bind(accessory: PlatformAccessory, device: DiscoveredDevice<TContext>): void {
    this.handlers.get(accessory.UUID)?.dispose();
    try {
      this.handlers.set(accessory.UUID, this.createHandler(accessory, device));
    } catch (err) {
      this.log.error(`Failed to set up "${device.displayName}": ${errorMessage(err)}`);
    }
  }
}

/** Read a positive number from config with a default and sane bounds. */
export function numberOption(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
