import { describe, expect, it } from 'vitest';
import { WriteCoalescer } from '../src/coalesce.js';

interface Fan {
  active: number;
  speed: number;
}

describe('WriteCoalescer', () => {
  it('merges writes inside the window into one apply call', async () => {
    const batches: Array<Partial<Fan>> = [];
    const c = new WriteCoalescer<Fan>(async (ch) => {
      batches.push(ch);
    }, 30);
    const a = c.write('active', 1);
    const b = c.write('speed', 67);
    await Promise.all([a, b]);
    expect(batches).toEqual([{ active: 1, speed: 67 }]);
  });

  it('last write for a key wins within a batch', async () => {
    const batches: Array<Partial<Fan>> = [];
    const c = new WriteCoalescer<Fan>(async (ch) => {
      batches.push(ch);
    }, 30);
    await Promise.all([c.write('speed', 10), c.write('speed', 50)]);
    expect(batches).toEqual([{ speed: 50 }]);
  });

  it('separate windows produce separate, ordered batches', async () => {
    const batches: Array<Partial<Fan>> = [];
    const c = new WriteCoalescer<Fan>(async (ch) => {
      await new Promise((r) => setTimeout(r, 20));
      batches.push(ch);
    }, 10);
    await c.write('active', 1);
    await c.write('active', 0);
    expect(batches).toEqual([{ active: 1 }, { active: 0 }]);
  });

  it('rejects every waiter in a failed batch', async () => {
    const c = new WriteCoalescer<Fan>(async () => {
      throw new Error('boom');
    }, 10);
    await expect(Promise.all([c.write('active', 1), c.write('speed', 5)])).rejects.toThrow('boom');
  });
});
