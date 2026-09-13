export const PLATFORM_NAME = 'MMLitterRobot';
export const PLUGIN_NAME = 'homebridge-mm-litterrobot';

export interface LitterRobotPlatformConfig {
  name?: string;
  username?: string;
  password?: string;
  pollIntervalSec?: number;
  /** A sensor carrying the same "drawer is full" fact, which certainly renders and can automate. */
  exposeDrawerAlert?: boolean;
  /** A plain switch for "I emptied it", in case the filter service's own reset is unreachable. */
  exposeResetSwitch?: boolean;
  exposeCleanCycle?: boolean;
  /** Treat a robot that reports itself switched off as something needing attention. */
  alertWhenPoweredOff?: boolean;
  /** How long a robot must stay unreachable or switched off before that counts. */
  attentionDebounceMinutes?: number;
  /** Only consulted when the robot reports no litter state of its own. */
  litterLowPercent?: number;
  /** Data older than this counts as not reporting in, even if the cloud claims the robot is online. */
  staleMinutes?: number;
  removeStale?: boolean;
  /** Undocumented: override endpoints (tests). */
  cognitoUrl?: string;
  graphqlUrl?: string;
}
