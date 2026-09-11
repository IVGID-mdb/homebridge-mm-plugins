export const PLATFORM_NAME = 'MMBond';
export const PLUGIN_NAME = 'homebridge-mm-bond';

export interface BondBridgeConfig {
  host: string;
  token: string;
}

export interface BondPlatformConfig {
  name?: string;
  bonds?: BondBridgeConfig[];
  pollIntervalSec?: number;
  push?: boolean;
  /** Undocumented: override the BPUP UDP port (tests). */
  pushPort?: number;
  removeStale?: boolean;
  exclude?: string[];
}
