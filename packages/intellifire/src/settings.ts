export const PLATFORM_NAME = 'MMIntellifire';
export const PLUGIN_NAME = 'homebridge-mm-intellifire';

export type ControlMode = 'auto' | 'local' | 'cloud';

export interface FireplaceOverride {
  serial?: string;
  ip?: string;
  name?: string;
}

export interface IntellifirePlatformConfig {
  name?: string;
  username?: string;
  password?: string;
  user?: string;
  auth_cookie?: string;
  web_client_id?: string;
  mode?: ControlMode;
  fireplaces?: FireplaceOverride[];
  localPollIntervalSec?: number;
  cloudPollIntervalSec?: number;
  exposeSwitch?: boolean;
  exposeBlower?: boolean;
  exposeLight?: boolean;
  removeStale?: boolean;
  /** Undocumented: override endpoints (tests). */
  cloudBaseUrl?: string;
  discoveryPort?: number;
  discoveryListenPort?: number;
  discoveryTimeoutMs?: number;
}
