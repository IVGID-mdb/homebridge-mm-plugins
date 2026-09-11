export const PLATFORM_NAME = 'MMLitterRobot';
export const PLUGIN_NAME = 'homebridge-mm-litterrobot';

export interface LitterRobotPlatformConfig {
  name?: string;
  username?: string;
  password?: string;
  pollIntervalSec?: number;
  exposeCleanSwitch?: boolean;
  exposeNightLight?: boolean;
  exposeOccupancy?: boolean;
  exposeResetSwitch?: boolean;
  removeStale?: boolean;
  /** Undocumented: override endpoints (tests). */
  cognitoUrl?: string;
  graphqlUrl?: string;
}
