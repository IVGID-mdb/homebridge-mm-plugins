/**
 * Bond Local API v2 client. Reference: https://docs-local.appbond.com/
 *
 * Design rules that matter for RF devices:
 *  - Actions are NEVER retried automatically. A retried "TogglePower" on a one-way RF fan
 *    would flip it back; a retried SetSpeed is harmless but we keep one rule for all.
 *  - Reads (GET) may be retried once on network/timeout errors.
 *  - Every request carries a BOND-UUID so the bridge can de-duplicate a resent packet itself.
 */
import { randomUUID } from 'node:crypto';
import { HttpError, requestJson } from '@mm/hb-core';

export interface BondVersion {
  bondid: string;
  fw_ver: string;
  make?: string;
  model?: string;
  target?: string;
  api?: number;
}

export type BondDeviceType = 'CF' | 'FP' | 'MS' | 'GX' | 'LT' | 'BD' | string;

export interface BondDeviceInfo {
  name: string;
  type: BondDeviceType;
  subtype?: string;
  location?: string;
  template?: string;
  actions: string[];
  /** Present only on Smart-by-Bond / Bond Bridge devices with command lists. */
  commands?: unknown;
}

export interface BondDeviceProperties {
  max_speed?: number;
  trust_state?: boolean;
  feature_light?: boolean;
  feature_brightness?: boolean;
  [k: string]: unknown;
}

export interface BondDeviceState {
  power?: number;
  speed?: number;
  /** 1 = forward (summer), -1 = reverse (winter). */
  direction?: number;
  light?: number;
  brightness?: number;
  up_light?: number;
  down_light?: number;
  flame?: number;
  open?: number;
  position?: number;
  [k: string]: unknown;
}

export interface BondDevice {
  id: string;
  info: BondDeviceInfo;
  properties: BondDeviceProperties;
}

export class BondApi {
  private readonly base: string;

  constructor(
    readonly host: string,
    private readonly token: string,
    private readonly timeoutMs = 4000,
  ) {
    this.base = `http://${host}/v2`;
  }

  getVersion(): Promise<BondVersion> {
    return this.get<BondVersion>('/sys/version');
  }

  async getDeviceIds(): Promise<string[]> {
    const list = await this.get<Record<string, unknown>>('/devices');
    return Object.keys(list).filter((k) => k.length > 0 && !k.startsWith('_'));
  }

  async getDevice(id: string): Promise<BondDevice> {
    const [info, properties] = await Promise.all([
      this.get<BondDeviceInfo>(`/devices/${id}`),
      this.get<BondDeviceProperties>(`/devices/${id}/properties`).catch(() => ({}) as BondDeviceProperties),
    ]);
    return { id, info: { ...info, actions: Array.isArray(info.actions) ? info.actions : [] }, properties };
  }

  getState(id: string): Promise<BondDeviceState> {
    return this.get<BondDeviceState>(`/devices/${id}/state`);
  }

  /** PUT /devices/{id}/actions/{action} with `{}` or `{"argument": value}`. Not retried. */
  async action(id: string, action: string, argument?: number | string): Promise<void> {
    const body = argument === undefined ? {} : { argument };
    await requestJson<unknown>(`${this.base}/devices/${id}/actions/${action}`, {
      method: 'PUT',
      headers: this.headers(),
      body,
      timeoutMs: this.timeoutMs,
    });
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.base}${path}`;
    try {
      return await requestJson<T>(url, { headers: this.headers(), timeoutMs: this.timeoutMs });
    } catch (err) {
      if (err instanceof HttpError && (err.kind === 'timeout' || err.kind === 'network')) {
        return requestJson<T>(url, { headers: this.headers(), timeoutMs: this.timeoutMs });
      }
      throw err;
    }
  }

  private headers(): Record<string, string> {
    return { 'BOND-Token': this.token, 'BOND-UUID': randomUUID() };
  }
}
