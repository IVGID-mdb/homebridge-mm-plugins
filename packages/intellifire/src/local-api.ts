/**
 * IntelliFire local (LAN) API, as implemented by the Wi-Fi module.
 *   GET  http://<ip>/poll            → state JSON (numbers)
 *   GET  http://<ip>/get_challenge   → hex challenge, valid ~10 s
 *   POST http://<ip>/post            → form: command, value, user, response
 * Signing (same as intellifire4py):
 *   payload  = "post:command=<command>&value=<value>"
 *   sig      = sha256(apikey_bytes + challenge_bytes + payload_bytes)
 *   response = hex(sha256(apikey_bytes + sig))
 * A 403 means the challenge expired; we fetch a new one and retry a couple of times.
 */
import { createHash } from 'node:crypto';
import { HttpError, request, requestJson } from '@mm/hb-core';
import type { FireplaceCommand } from './state.js';
import { COMMAND_NAMES, validateCommand } from './state.js';

export function signLocalCommand(apiKeyHex: string, challengeHex: string, command: string, value: number | string): string {
  const apiKey = Buffer.from(apiKeyHex, 'hex');
  const challenge = Buffer.from(challengeHex.trim(), 'hex');
  const payload = Buffer.from(`post:command=${command}&value=${value}`);
  const sig = createHash('sha256').update(Buffer.concat([apiKey, challenge, payload])).digest();
  return createHash('sha256').update(Buffer.concat([apiKey, sig])).digest('hex');
}

export class IntellifireLocal {
  constructor(
    readonly ip: string,
    private readonly apiKey: string,
    private readonly userId: string,
    private readonly timeoutMs = 4000,
  ) {}

  poll(): Promise<Record<string, unknown>> {
    return requestJson<Record<string, unknown>>(`http://${this.ip}/poll`, { timeoutMs: this.timeoutMs });
  }

  async send(command: FireplaceCommand, value: number): Promise<void> {
    const v = validateCommand(command, value);
    const wire = COMMAND_NAMES[command].local;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const challenge = (await request(`http://${this.ip}/get_challenge`, { timeoutMs: this.timeoutMs })).text.trim();
      const body = new URLSearchParams({
        command: wire,
        value: String(v),
        user: this.userId,
        response: signLocalCommand(this.apiKey, challenge, wire, v),
      });
      try {
        await request(`http://${this.ip}/post`, { method: 'POST', body, timeoutMs: this.timeoutMs, okStatuses: [204] });
        return;
      } catch (err) {
        lastErr = err;
        if (err instanceof HttpError && err.status === 403) continue; // challenge expired → retry
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('local command failed');
  }
}
