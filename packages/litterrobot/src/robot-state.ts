import type { RobotData } from './whisker-api.js';

/** Derived, HomeKit-facing view of a robot. Pure functions so they are trivially testable. */
export interface RobotView {
  online: boolean;
  powered: boolean;
  cycling: boolean;
  catDetected: boolean;
  drawerFull: boolean;
  /** 0..100, 100 = empty drawer. */
  drawerRemainingPct: number;
  /** 0..100 litter level. */
  litterPct: number;
  nightLightOn: boolean;
  bonnetRemoved: boolean;
  status: string;
}

const CYCLING = new Set(['ROBOT_CLEAN', 'ROBOT_FIND_DUMP', 'ROBOT_EMPTY']);
const CAT = new Set(['ROBOT_CAT_DETECT', 'ROBOT_CAT_DETECT_DELAY']);

export function viewOf(r: RobotData): RobotView {
  const status = String(r.robotStatus ?? '');
  const powerStatus = String(r.unitPowerStatus ?? '').toUpperCase();
  const online = r.isOnline !== false;
  const powered = online && powerStatus !== 'OFF' && status !== 'ROBOT_POWER_OFF' && status !== 'ROBOT_POWER_DOWN';
  const cycleState = String(r.robotCycleState ?? '');
  const catDetect = String(r.catDetect ?? '');
  return {
    online,
    powered,
    cycling: powered && CYCLING.has(status),
    catDetected:
      CAT.has(status) ||
      cycleState === 'CYCLE_STATE_CAT_DETECT' ||
      (catDetect.startsWith('CAT_DETECT') && catDetect !== 'CAT_DETECT_CLEAR'),
    drawerFull: Boolean(r.isDFIFull),
    drawerRemainingPct: clampPct(100 - num(r.DFILevelPercent, 0)),
    litterPct: clampPct(num(r.litterLevelPercentage, 1) <= 1 ? num(r.litterLevelPercentage, 1) * 100 : num(r.litterLevelPercentage, 100)),
    nightLightOn: String(r.nightLightMode ?? 'OFF').toUpperCase() !== 'OFF',
    bonnetRemoved: Boolean(r.isBonnetRemoved) || status === 'ROBOT_BONNET',
    status,
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clampPct(v: number): number {
  return Math.round(Math.min(100, Math.max(0, v)));
}
