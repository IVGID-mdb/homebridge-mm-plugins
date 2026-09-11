export const PLATFORM_NAME = 'MMModernForms';
export const PLUGIN_NAME = 'homebridge-mm-modernforms';

export interface FanConfig {
  host: string;
  name?: string;
}

export interface ModernFormsPlatformConfig {
  name?: string;
  fans?: FanConfig[];
  pollIntervalSec?: number;
  breezeAsSwingMode?: boolean;
  removeStale?: boolean;
}
