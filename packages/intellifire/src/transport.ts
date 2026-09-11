/**
 * One interface over the two ways to reach a fireplace, plus an "auto" strategy that prefers
 * local (fast, works when the internet is down) and falls back to cloud when local fails,
 * re-trying local every so often.
 */
import type { Log } from '@mm/hb-core';
import { errorMessage } from '@mm/hb-core';
import type { IntellifireCloud } from './cloud-api.js';
import type { IntellifireLocal } from './local-api.js';
import type { FireplaceCommand } from './state.js';

export interface FireplaceTransport {
  readonly name: string;
  poll(): Promise<Record<string, unknown>>;
  send(command: FireplaceCommand, value: number): Promise<void>;
}

export class LocalTransport implements FireplaceTransport {
  readonly name = 'local';
  constructor(private readonly local: IntellifireLocal) {}
  poll(): Promise<Record<string, unknown>> {
    return this.local.poll();
  }
  send(command: FireplaceCommand, value: number): Promise<void> {
    return this.local.send(command, value);
  }
}

export class CloudTransport implements FireplaceTransport {
  readonly name = 'cloud';
  constructor(
    private readonly cloud: IntellifireCloud,
    private readonly serial: string,
  ) {}
  poll(): Promise<Record<string, unknown>> {
    return this.cloud.poll(this.serial);
  }
  send(command: FireplaceCommand, value: number): Promise<void> {
    return this.cloud.send(this.serial, command, value);
  }
}

export class AutoTransport implements FireplaceTransport {
  readonly name = 'auto';
  private localFailures = 0;
  private localDownSince = 0;

  constructor(
    private readonly local: FireplaceTransport | undefined,
    private readonly cloud: FireplaceTransport | undefined,
    private readonly log: Log,
    private readonly retryLocalAfterMs = 120_000,
  ) {
    if (!local && !cloud) throw new Error('AutoTransport needs at least one transport');
  }

  /** Which path is currently active (for logging / tests). */
  get active(): 'local' | 'cloud' {
    if (this.local && !this.localIsDown()) return 'local';
    return this.cloud ? 'cloud' : 'local';
  }

  private localIsDown(): boolean {
    if (this.localFailures < 2) return false;
    if (Date.now() - this.localDownSince > this.retryLocalAfterMs) {
      // time to give local another chance
      this.localFailures = 1;
      return false;
    }
    return true;
  }

  private noteLocal(ok: boolean): void {
    if (ok) {
      if (this.localFailures >= 2) this.log.info('local connection restored');
      this.localFailures = 0;
      return;
    }
    this.localFailures += 1;
    if (this.localFailures === 2) {
      this.localDownSince = Date.now();
      this.log.warn(`local connection failing${this.cloud ? ', using cloud until it recovers' : ''}`);
    }
  }

  async poll(): Promise<Record<string, unknown>> {
    if (this.local && !this.localIsDown()) {
      try {
        const r = await this.local.poll();
        this.noteLocal(true);
        return r;
      } catch (err) {
        this.noteLocal(false);
        if (!this.cloud) throw err;
        this.log.debug(`local poll failed (${errorMessage(err)}), trying cloud`);
      }
    }
    if (!this.cloud) throw new Error('local unavailable and no cloud session');
    return this.cloud.poll();
  }

  async send(command: FireplaceCommand, value: number): Promise<void> {
    if (this.local && !this.localIsDown()) {
      try {
        await this.local.send(command, value);
        this.noteLocal(true);
        return;
      } catch (err) {
        this.noteLocal(false);
        if (!this.cloud) throw err;
        this.log.debug(`local ${command} failed (${errorMessage(err)}), trying cloud`);
      }
    }
    if (!this.cloud) throw new Error('local unavailable and no cloud session');
    await this.cloud.send(command, value);
  }
}
