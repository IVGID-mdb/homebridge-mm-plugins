/**
 * IntelliFire cloud (iftapi.net). Cookie-authenticated:
 *   POST /a//login (form username/password)         → Set-Cookie: user, auth_cookie, web_client_id
 *   GET  /a//enumlocations                           → {locations:[{location_id,...}]}
 *   GET  /a//enumfireplaces?location_id=X            → {fireplaces:[{serial,apikey,name,brand,power}]}
 *   GET  /a/{serial}//apppoll                        → state (all values are strings)
 *   POST /a/{serial}//apppost (form <command>=<value>)
 * The `user` cookie doubles as the user id needed for local (LAN) commands, and `apikey`
 * from enumfireplaces is the per-fireplace signing key for the local API.
 */
import { HttpError, request, requestJson } from '@mm/hb-core';
import type { FireplaceCommand } from './state.js';
import { COMMAND_NAMES, validateCommand } from './state.js';

export interface CloudCookies {
  user: string;
  auth_cookie: string;
  web_client_id: string;
}

export interface CloudFireplace {
  serial: string;
  apikey: string;
  name: string;
  brand: string;
}

export class IntellifireCloud {
  private cookies: Partial<CloudCookies> = {};

  constructor(
    private readonly baseUrl = 'https://iftapi.net',
    private readonly timeoutMs = 10_000,
  ) {}

  setCookies(c: Partial<CloudCookies>): void {
    this.cookies = { ...c };
  }

  getCookies(): Partial<CloudCookies> {
    return { ...this.cookies };
  }

  get userId(): string | undefined {
    return this.cookies.user;
  }

  get hasSession(): boolean {
    return Boolean(this.cookies.user && this.cookies.auth_cookie && this.cookies.web_client_id);
  }

  async login(username: string, password: string): Promise<CloudCookies> {
    const body = new URLSearchParams({ username, password });
    const res = await request(`${this.baseUrl}/a//login`, { method: 'POST', body, timeoutMs: this.timeoutMs, okStatuses: [204] });
    const jar: Record<string, string> = {};
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair?.indexOf('=') ?? -1;
      if (pair && eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
    if (!jar.user || !jar.auth_cookie || !jar.web_client_id) {
      throw new Error('IntelliFire login did not return the expected cookies (bad credentials?)');
    }
    this.cookies = { user: jar.user, auth_cookie: jar.auth_cookie, web_client_id: jar.web_client_id };
    return this.cookies as CloudCookies;
  }

  async listFireplaces(): Promise<CloudFireplace[]> {
    const locs = await this.getJson<{ locations?: Array<{ location_id: string }> }>('/a//enumlocations');
    const out: CloudFireplace[] = [];
    for (const loc of locs.locations ?? []) {
      const fps = await this.getJson<{ fireplaces?: Array<Record<string, unknown>> }>(
        `/a//enumfireplaces?location_id=${encodeURIComponent(loc.location_id)}`,
      );
      for (const f of fps.fireplaces ?? []) {
        if (typeof f.serial !== 'string') continue;
        out.push({
          serial: f.serial,
          apikey: String(f.apikey ?? ''),
          name: String(f.name ?? f.serial),
          brand: String(f.brand ?? 'IntelliFire'),
        });
      }
    }
    return out;
  }

  poll(serial: string): Promise<Record<string, unknown>> {
    return this.getJson<Record<string, unknown>>(`/a/${encodeURIComponent(serial)}//apppoll`);
  }

  async send(serial: string, command: FireplaceCommand, value: number): Promise<void> {
    const v = validateCommand(command, value);
    const body = new URLSearchParams({ [COMMAND_NAMES[command].cloud]: String(v) });
    await request(`${this.baseUrl}/a/${encodeURIComponent(serial)}//apppost`, {
      method: 'POST',
      body,
      headers: this.headers(),
      timeoutMs: this.timeoutMs,
      okStatuses: [204],
    });
  }

  private async getJson<T>(path: string): Promise<T> {
    try {
      return await requestJson<T>(`${this.baseUrl}${path}`, { headers: this.headers(), timeoutMs: this.timeoutMs });
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        throw new CloudAuthError(`IntelliFire cloud rejected the session (${err.status})`);
      }
      throw err;
    }
  }

  private headers(): Record<string, string> {
    const parts = Object.entries(this.cookies)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`);
    return parts.length ? { cookie: parts.join('; ') } : {};
  }
}

export class CloudAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudAuthError';
  }
}
