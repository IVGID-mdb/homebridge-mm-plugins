import type { RobotData } from './whisker-api.js';

/** Derived, HomeKit-facing view of a robot. Pure functions so they are trivially testable. */
export interface RobotView {
  /** The cloud believes it is in contact with the robot. */
  online: boolean;
  /** The robot reports its own power switch off. Only meaningful while online. */
  poweredOff: boolean;
  /** Reachable and switched on. */
  powered: boolean;
  cycling: boolean;
  catDetected: boolean;
  /** The raw cat field, kept so an unfamiliar value can be logged rather than silently trusted. */
  catDetectRaw: string;
  /** False when the cat field held a value this code does not recognise. */
  catDetectRecognised: boolean;
  drawerFull: boolean;
  /** 0..100 remaining drawer capacity, so 100 means freshly emptied. */
  drawerRemainingPct: number;
  /** 0..100 litter remaining. Scale is ambiguous upstream, so never let this alone raise an alert. */
  litterPct: number;
  /** The robot's own verdict on litter, which is trusted ahead of the percentage. */
  litterLowReported: boolean | undefined;
  bonnetRemoved: boolean;
  /** Whether an optional LitterHopper appears to be attached at all. */
  hopperFitted: boolean;
  hopperProblem: boolean;
  motorFault: boolean;
  laserDirty: boolean;
  /** Epoch ms of the robot's last contact, when the cloud reports one. */
  lastSeenAt: number | undefined;
  status: string;
}

const CYCLING = new Set(['ROBOT_CLEAN', 'ROBOT_FIND_DUMP', 'ROBOT_EMPTY']);
const CAT = new Set(['ROBOT_CAT_DETECT', 'ROBOT_CAT_DETECT_DELAY']);
const POWER_OFF = new Set(['ROBOT_POWER_OFF', 'ROBOT_POWER_DOWN']);

/** Values of catDetect that positively mean "the globe is empty". Everything else means a cat. */
const CAT_CLEAR = /^(CAT_DETECT_CLEAR|CLEAR|NONE|FALSE|NO|0)$/;
/** Shapes of catDetect this code has seen before. An unfamiliar value is still treated as a cat. */
const CAT_KNOWN = /^(CAT_DETECT.*|CLEAR|NONE|FALSE|NO|0)$/;

export function viewOf(r: RobotData): RobotView {
  const status = String(r.robotStatus ?? '');
  const powerStatus = String(r.unitPowerStatus ?? '').toUpperCase();
  const online = r.isOnline !== false;
  const poweredOff = powerStatus === 'OFF' || POWER_OFF.has(status);
  const cycleState = String(r.robotCycleState ?? '');
  const catDetectRaw = String(r.catDetect ?? '').trim().toUpperCase();
  const hopper = hopperOf(r);
  return {
    online,
    poweredOff,
    powered: online && !poweredOff,
    cycling: online && !poweredOff && CYCLING.has(status),
    // FAIL CLOSED. This predicate gates a rotating globe, so an unfamiliar value must mean a cat
    // is present, never that the coast is clear. Only a positively recognised clear value clears it.
    catDetected: CAT.has(status) || cycleState === 'CYCLE_STATE_CAT_DETECT' || (catDetectRaw !== '' && !CAT_CLEAR.test(catDetectRaw)),
    catDetectRaw,
    catDetectRecognised: catDetectRaw === '' || CAT_KNOWN.test(catDetectRaw),
    drawerFull: Boolean(r.isDFIFull),
    drawerRemainingPct: clampPct(100 - num(r.DFILevelPercent, 0)),
    litterPct: litterRemaining(r.litterLevelPercentage),
    litterLowReported: litterStateLow(r.litterLevelState),
    bonnetRemoved: Boolean(r.isBonnetRemoved) || status === 'ROBOT_BONNET',
    hopperFitted: hopper.fitted,
    hopperProblem: hopper.problem,
    motorFault: motorFaultOf(r.globeMotorFaultStatus),
    laserDirty: Boolean(r.isLaserDirty),
    lastSeenAt: parseTime(r.lastSeen),
    status,
  };
}

/** Everything that should put the accessory into "something needs looking at". */
export interface AttentionState {
  needsAttention: boolean;
  /** Human-readable causes, most actionable first. Used for logging, not for HomeKit. */
  reasons: string[];
  /** True only for hardware causes, so connectivity does not masquerade as a broken machine. */
  hardwareFault: boolean;
}

export interface SustainedFlags {
  /** The robot has been unreachable or stale for longer than the debounce. */
  offline: boolean;
  /** The robot has reported itself switched off for longer than the debounce. */
  poweredOff: boolean;
}

export function attentionOf(v: RobotView, sustained: SustainedFlags, litterLowPercent: number): AttentionState {
  const reasons: string[] = [];
  if (v.motorFault) reasons.push('globe motor fault');
  if (v.bonnetRemoved) reasons.push('bonnet removed');
  if (v.laserDirty) reasons.push('litter sensor needs cleaning');
  if (v.hopperProblem) reasons.push('litter hopper removed or jammed');
  if (litterIsLow(v, litterLowPercent)) reasons.push('litter running low');
  if (sustained.poweredOff) reasons.push('switched off');
  if (sustained.offline) reasons.push('not reporting in');
  return {
    needsAttention: reasons.length > 0,
    reasons,
    hardwareFault: v.motorFault || v.laserDirty,
  };
}

/**
 * The robot's own LOW verdict wins. The percentage is only consulted when the robot does not
 * report a state, because its scale is ambiguous upstream and a genuine 1 % reading is
 * indistinguishable from a 100 % one.
 */
export function litterIsLow(v: RobotView, litterLowPercent: number): boolean {
  if (v.litterLowReported !== undefined) return v.litterLowReported;
  return v.litterPct <= litterLowPercent;
}

/**
 * The LitterHopper is an optional accessory. An account without one reports it as removed, so
 * treating that as a fault would pin the alert on forever and make the whole channel useless.
 * A hopper only counts as fitted when the robot reports a status for it that is not an
 * absent marker, and only a positively recognised fault word counts as trouble.
 */
function hopperOf(r: RobotData): { fitted: boolean; problem: boolean } {
  const s = String(r.hopperStatus ?? '').trim().toUpperCase();
  const absent = s === '' || /DISABLED|NOT_INSTALLED|UNINSTALLED|ABSENT|NONE|REMOVED/.test(s);
  if (absent) return { fitted: false, problem: false };
  const faulty = /FAULT|JAM|STALL|ERROR|EMPTY|MOTOR_FAULT/.test(s) || Boolean(r.isHopperRemoved);
  return { fitted: true, problem: faulty };
}

/**
 * FAIL OPEN, deliberately, and opposite to the cat guard. The motor-status vocabulary is not
 * documented, so treating every unfamiliar string as a fault would latch a hardware alert that
 * can never clear on a perfectly healthy robot. Only a recognised fault word counts.
 */
function motorFaultOf(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v ?? '').toUpperCase();
  if (!s) return false;
  if (/CLEAR|NONE|NO_FAULT|NOMINAL|GOOD|^OK$|^FALSE$|^0$/.test(s)) return false;
  return /FAULT|STALL|JAM|OVERCURRENT|ERROR|FAIL/.test(s);
}

function litterStateLow(state: unknown): boolean | undefined {
  const s = String(state ?? '').toUpperCase();
  if (!s) return undefined;
  if (s.includes('LOW') || s.includes('EMPTY')) return true;
  if (s.includes('OPTIMAL') || s.includes('GOOD') || s.includes('FULL') || s.includes('NOMINAL')) return false;
  return undefined;
}

/**
 * litterLevelPercentage arrives either as a 0..1 fraction or a 0..100 percentage depending on
 * firmware. A value at or below 1 is read as a fraction, which misreads a genuine 1 % as full.
 * That ambiguity is why the alert never depends on this number.
 */
function litterRemaining(raw: unknown): number {
  const n = num(raw, NaN);
  if (!Number.isFinite(n)) return 100;
  return clampPct(n <= 1 ? n * 100 : n);
}

function parseTime(v: unknown): number | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clampPct(v: number): number {
  return Math.round(Math.min(100, Math.max(0, v)));
}
