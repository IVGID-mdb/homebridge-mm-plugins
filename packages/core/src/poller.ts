import type { Log } from './logging.js';
import { errorMessage } from './logging.js';

export interface PollerOptions {
  intervalMs: number;
  /** Multiply the interval by this after each consecutive failure (capped). Default 2. */
  backoffFactor?: number;
  /** Never wait longer than this between attempts. Default 5 × interval. */
  maxIntervalMs?: number;
  /** ± fraction of jitter so many devices don't poll in lockstep. Default 0.1. */
  jitter?: number;
  log?: Log;
  name?: string;
}

/**
 * Runs an async function on an interval with the three properties every device poller needs:
 *  1. never overlaps (a slow request doesn't stack up),
 *  2. backs off on failure and recovers on success,
 *  3. timers are unref'd so they never keep Homebridge alive at shutdown.
 */
export class Poller {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private inFlight: Promise<void> | undefined;
  private failures = 0;

  constructor(
    private readonly fn: () => Promise<void>,
    private readonly opts: PollerOptions,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Run one poll right now (e.g. after a command) without disturbing the schedule. */
  async now(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    return this.runOnce();
  }

  get consecutiveFailures(): number {
    return this.failures;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    await this.runOnce();
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick(), this.nextDelay());
    this.timer.unref?.();
  }

  nextDelay(): number {
    const factor = Math.pow(this.opts.backoffFactor ?? 2, Math.min(this.failures, 8));
    const base = Math.min(this.opts.intervalMs * factor, this.opts.maxIntervalMs ?? this.opts.intervalMs * 5);
    const jitter = this.opts.jitter ?? 0.1;
    return Math.max(50, Math.round(base * (1 + (Math.random() * 2 - 1) * jitter)));
  }

  private runOnce(): Promise<void> {
    const name = this.opts.name ?? 'poller';
    this.inFlight = (async () => {
      try {
        await this.fn();
        if (this.failures > 0) {
          this.opts.log?.info(`${name}: recovered after ${this.failures} failure(s)`);
        }
        this.failures = 0;
      } catch (err) {
        this.failures += 1;
        const msg = `${name}: poll failed (${this.failures}x): ${errorMessage(err)}`;
        if (this.failures === 1 || this.failures % 10 === 0) this.opts.log?.warn(msg);
        else this.opts.log?.debug(msg);
      } finally {
        this.inFlight = undefined;
      }
    })();
    return this.inFlight;
  }
}
