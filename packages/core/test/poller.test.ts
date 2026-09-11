import { describe, expect, it } from 'vitest';
import { Poller } from '../src/poller.js';

describe('Poller', () => {
  it('runs immediately, then on the interval, and never overlaps', async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const p = new Poller(
      async () => {
        calls++;
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
      },
      { intervalMs: 50, jitter: 0 },
    );
    p.start();
    await new Promise((r) => setTimeout(r, 300));
    p.stop();
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(maxActive).toBe(1);
  });

  it('backs off after failures and recovers after success', async () => {
    let fail = true;
    const p = new Poller(
      async () => {
        if (fail) throw new Error('down');
      },
      { intervalMs: 100, jitter: 0, backoffFactor: 2, maxIntervalMs: 800 },
    );
    await p.now();
    await p.now();
    expect(p.consecutiveFailures).toBe(2);
    expect(p.nextDelay()).toBe(400);
    await p.now();
    expect(p.nextDelay()).toBe(800);
    fail = false;
    await p.now();
    expect(p.consecutiveFailures).toBe(0);
    expect(p.nextDelay()).toBe(100);
  });

  it('now() shares an in-flight poll instead of starting a second one', async () => {
    let calls = 0;
    const p = new Poller(
      async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 30));
      },
      { intervalMs: 1000 },
    );
    await Promise.all([p.now(), p.now(), p.now()]);
    expect(calls).toBe(1);
  });
});
