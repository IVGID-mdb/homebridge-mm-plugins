/**
 * HomeKit's RotationSpeed characteristic is a float percentage 0..100 with minStep 1
 * (HAP spec). Real fans have N discrete levels. These helpers quantize between the two
 * without ever producing a value HAP would reject.
 *
 * Contract:
 *  - percent 0 always means level 0 (off).
 *  - any percent > 0 maps to a level in 1..levels.
 *  - levelToPercent(percentToLevel(p)) is the canonical percent HomeKit is told about,
 *    so the Home app slider snaps to the nearest real speed after a write.
 */
export function percentToLevel(percent: number, levels: number): number {
  assertLevels(levels);
  const p = clamp(Number(percent) || 0, 0, 100);
  if (p <= 0) return 0;
  // Nearest level, but never 0 for a positive percent (1 % must still mean "lowest speed").
  return clamp(Math.round((p / 100) * levels), 1, levels);
}

export function levelToPercent(level: number, levels: number): number {
  assertLevels(levels);
  const l = clamp(Math.round(Number(level) || 0), 0, levels);
  if (l <= 0) return 0;
  return clamp(Math.round((l / levels) * 100), 1, 100);
}

/** Canonical percent for a raw HomeKit write, i.e. what we echo back via updateValue. */
export function snapPercent(percent: number, levels: number): number {
  return levelToPercent(percentToLevel(percent, levels), levels);
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function assertLevels(levels: number): void {
  if (!Number.isInteger(levels) || levels < 1) {
    throw new RangeError(`levels must be a positive integer, got ${levels}`);
  }
}
