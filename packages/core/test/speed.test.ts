import { describe, expect, it } from 'vitest';
import { levelToPercent, percentToLevel, snapPercent } from '../src/speed.js';

describe('speed quantization', () => {
  it('maps 0 to off and 100 to top level for any level count', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 8, 10]) {
      expect(percentToLevel(0, n)).toBe(0);
      expect(percentToLevel(100, n)).toBe(n);
      expect(levelToPercent(0, n)).toBe(0);
      expect(levelToPercent(n, n)).toBe(100);
    }
  });

  it('never maps a positive percent to level 0', () => {
    for (const n of [3, 6]) {
      for (let p = 1; p <= 100; p++) {
        const l = percentToLevel(p, n);
        expect(l).toBeGreaterThanOrEqual(1);
        expect(l).toBeLessThanOrEqual(n);
      }
    }
  });

  it('3-speed fan (Bond RCF119): nearest speed wins, 1 % is still low', () => {
    expect(percentToLevel(1, 3)).toBe(1);
    expect(percentToLevel(33, 3)).toBe(1);
    expect(percentToLevel(49, 3)).toBe(1);
    expect(percentToLevel(50, 3)).toBe(2);
    expect(percentToLevel(67, 3)).toBe(2);
    expect(percentToLevel(83, 3)).toBe(2);
    expect(percentToLevel(84, 3)).toBe(3);
    expect(levelToPercent(1, 3)).toBe(33);
    expect(levelToPercent(2, 3)).toBe(67);
    expect(levelToPercent(3, 3)).toBe(100);
  });

  it('6-speed fan (Modern Forms): canonical percents are stable under round trip', () => {
    for (let l = 0; l <= 6; l++) {
      const p = levelToPercent(l, 6);
      expect(percentToLevel(p, 6)).toBe(l);
      expect(snapPercent(p, 6)).toBe(p);
    }
  });

  it('round trip is idempotent for every percent', () => {
    for (const n of [3, 4, 6]) {
      for (let p = 0; p <= 100; p++) {
        const s = snapPercent(p, n);
        expect(snapPercent(s, n)).toBe(s);
      }
    }
  });

  it('clamps garbage input', () => {
    expect(percentToLevel(-5, 3)).toBe(0);
    expect(percentToLevel(500, 3)).toBe(3);
    expect(percentToLevel(Number.NaN, 3)).toBe(0);
    expect(levelToPercent(99, 3)).toBe(100);
    expect(() => percentToLevel(50, 0)).toThrow(RangeError);
  });
});
