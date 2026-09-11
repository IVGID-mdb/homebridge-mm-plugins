/**
 * Modern Forms / WAC smart fan local API.
 * Single endpoint: POST http://<fan>/mf with a JSON body.
 *   {"queryStaticShadowData":1}  → identity (clientId, mac, deviceName, fanType, firmwareVersion, lightType…)
 *   {"queryDynamicShadowData":1} → full state
 *   {"fanOn":true,"fanSpeed":3,…} → set; the reply is the full new state
 * Captured from the bedroom fan (clientId MF_FCE8C0850234): fanSpeed 1..6, lightBrightness 1..100,
 * fanDirection "forward"|"reverse", wind (breeze) bool + windSpeed 1..3.
 */
import { requestJson } from '@mm/hb-core';

export const MF_SPEED_LEVELS = 6;

export interface MfInfo {
  clientId: string;
  mac: string;
  deviceName: string;
  fanType: string;
  firmwareVersion: string;
  lightType: string;
  hasLight: boolean;
}

export interface MfState {
  fanOn: boolean;
  fanSpeed: number;
  fanDirection: 'forward' | 'reverse';
  lightOn: boolean;
  lightBrightness: number;
  wind: boolean;
  windSpeed: number;
  /** true when the reply contained light fields at all. */
  hasLight: boolean;
}

export interface MfSet {
  fanOn?: boolean;
  fanSpeed?: number;
  fanDirection?: 'forward' | 'reverse';
  lightOn?: boolean;
  lightBrightness?: number;
  wind?: boolean;
  windSpeed?: number;
}

export class ModernFormsApi {
  constructor(
    readonly host: string,
    private readonly timeoutMs = 4000,
  ) {}

  async getInfo(): Promise<MfInfo> {
    const r = await this.post({ queryStaticShadowData: 1 });
    const clientId = str(r.clientId);
    return {
      clientId,
      mac: str(r.mac) || clientId.replace(/^MF_/, ''),
      deviceName: str(r.deviceName),
      fanType: str(r.fanType) || 'Smart Fan',
      firmwareVersion: str(r.firmwareVersion),
      lightType: str(r.lightType),
      hasLight: 'lightOn' in r || Boolean(str(r.lightType)),
    };
  }

  async getState(): Promise<MfState> {
    return parseState(await this.post({ queryDynamicShadowData: 1 }));
  }

  /** Apply a change; the fan echoes its complete state which we return parsed. */
  async set(change: MfSet): Promise<MfState> {
    return parseState(await this.post({ ...change }));
  }

  private post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return requestJson<Record<string, unknown>>(`http://${this.host}/mf`, {
      method: 'POST',
      body,
      timeoutMs: this.timeoutMs,
    });
  }
}

export function parseState(r: Record<string, unknown>): MfState {
  if (!r || typeof r !== 'object') throw new Error('fan reply was not an object');
  const speed = Math.round(num(r.fanSpeed, 1));
  return {
    fanOn: Boolean(r.fanOn),
    fanSpeed: Math.min(MF_SPEED_LEVELS, Math.max(1, speed)),
    fanDirection: r.fanDirection === 'reverse' ? 'reverse' : 'forward',
    lightOn: Boolean(r.lightOn),
    lightBrightness: Math.min(100, Math.max(1, Math.round(num(r.lightBrightness, 100)))),
    wind: Boolean(r.wind),
    windSpeed: Math.min(3, Math.max(1, Math.round(num(r.windSpeed, 1)))),
    hasLight: 'lightOn' in r,
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
