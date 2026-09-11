/**
 * Bond Push UDP Protocol (BPUP).
 *  - Client sends a single "\n" datagram to <bond>:30007; the bridge replies with
 *    {"B":"<bondid>"} and then streams state changes as
 *    {"B":"ZZ..","t":"devices/<id>/state","i":"<req id>","s":200,"m":0,"f":255,"b":{...state}}
 *  - The subscription expires after 60 s without a keep-alive, so we resend "\n" every 55 s.
 *  - If nothing (not even the keep-alive ack) arrives for 70 s we treat push as down; the
 *    accessory layer keeps polling regardless, so push is purely a latency improvement.
 */
import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import type { Log } from '@mm/hb-core';
import { silentLog } from '@mm/hb-core';

export const BPUP_PORT = 30007;
const KEEPALIVE_MS = 55_000;
const ALIVE_TIMEOUT_MS = 70_000;

export interface BpupStateEvent {
  bondId: string;
  deviceId: string;
  state: Record<string, unknown>;
}

export interface BpupMessage {
  B?: string;
  t?: string;
  s?: number;
  b?: Record<string, unknown>;
}

/** Pure parser so it can be unit tested without sockets. */
export function parseBpup(datagram: string): BpupStateEvent | { bondId: string } | undefined {
  let msg: BpupMessage;
  try {
    msg = JSON.parse(datagram.trim()) as BpupMessage;
  } catch {
    return undefined;
  }
  if (!msg || typeof msg !== 'object' || typeof msg.B !== 'string') return undefined;
  if (typeof msg.t !== 'string') return { bondId: msg.B }; // keep-alive ack
  if (msg.s !== undefined && msg.s !== 200) return undefined;
  const parts = msg.t.split('/');
  if (parts.length < 3 || parts[0] !== 'devices' || parts[2] !== 'state' || !msg.b) return undefined;
  return { bondId: msg.B, deviceId: parts[1]!, state: msg.b };
}

export class BpupClient extends EventEmitter {
  private socket: dgram.Socket | undefined;
  private keepalive: NodeJS.Timeout | undefined;
  private lastRx = 0;
  private stopped = false;

  constructor(
    private readonly host: string,
    private readonly log: Log = silentLog,
    private readonly port: number = BPUP_PORT,
  ) {
    super();
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = undefined;
    this.socket?.close();
    this.socket = undefined;
  }

  get alive(): boolean {
    return this.lastRx > 0 && Date.now() - this.lastRx < ALIVE_TIMEOUT_MS;
  }

  private open(): void {
    const socket = dgram.createSocket('udp4');
    this.socket = socket;
    socket.on('message', (buf) => {
      this.lastRx = Date.now();
      const parsed = parseBpup(buf.toString('utf8'));
      if (!parsed) return;
      if ('deviceId' in parsed) {
        this.emit('state', parsed);
      }
    });
    socket.on('error', (err) => {
      this.log.debug(`BPUP socket error: ${err.message}`);
      this.reopenLater();
    });
    socket.bind(() => {
      socket.unref();
      this.sendKeepalive();
      this.keepalive = setInterval(() => {
        if (this.lastRx && Date.now() - this.lastRx > ALIVE_TIMEOUT_MS) {
          this.log.debug('BPUP: no traffic for 70s, reopening socket');
          this.reopenLater();
          return;
        }
        this.sendKeepalive();
      }, KEEPALIVE_MS);
      this.keepalive.unref?.();
    });
  }

  private sendKeepalive(): void {
    this.socket?.send('\n', this.port, this.host, (err) => {
      if (err) this.log.debug(`BPUP send failed: ${err.message}`);
    });
  }

  private reopenLater(): void {
    if (this.stopped) return;
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = undefined;
    try {
      this.socket?.close();
    } catch {
      /* already closed */
    }
    this.socket = undefined;
    const t = setTimeout(() => {
      if (!this.stopped) this.open();
    }, 5000);
    t.unref?.();
  }
}
