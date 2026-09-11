/**
 * In-process IntelliFire test doubles:
 *  - FakeFireplaceModule: the Wi-Fi module's LAN API (/poll, /get_challenge, /post) with real
 *    signature verification, plus a UDP discovery responder.
 *  - FakeIftCloud: iftapi.net (login cookies, enumlocations, enumfireplaces, apppoll, apppost).
 * Poll payloads mirror the real module's field names; the cloud returns strings, local returns numbers.
 */
import http from 'node:http';
import dgram from 'node:dgram';
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export const SERIAL = 'ABCDEF1234567890';
export const APIKEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
export const USER_ID = '3BDAC8E5C7A47139C600B4FB885A1F5AD59846E4C12EC5B3F1EE09FDA5895435';

export interface ModuleState {
  power: number;
  height: number;
  fanspeed: number;
  light: number;
  thermostat: number;
  setpoint: number;
  temperature: number;
  pilot: number;
  hot: number;
  timer: number;
  timeremaining: number;
  feature_fan: number;
  feature_light: number;
  feature_thermostat: number;
  errors: number[];
  firmware_version_string: string;
  serial: string;
}

export function defaultState(): ModuleState {
  return {
    power: 0,
    height: 2,
    fanspeed: 0,
    light: 0,
    thermostat: 0,
    setpoint: 2200,
    temperature: 21,
    pilot: 0,
    hot: 0,
    timer: 0,
    timeremaining: 0,
    feature_fan: 1,
    feature_light: 1,
    feature_thermostat: 1,
    errors: [],
    firmware_version_string: '0x01020304',
    serial: SERIAL,
  };
}

export class FakeFireplaceModule {
  state: ModuleState = defaultState();
  readonly commands: Array<{ command: string; value: string; user: string }> = [];
  private challenge = '';
  private challengeIssued = 0;
  private server: http.Server | undefined;
  private udp: dgram.Socket | undefined;
  port = 0;
  udpPort = 0;
  /** Make the module drop off the network. */
  offline = false;
  challengeTtlMs = 10_000;

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as AddressInfo).port;
    this.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.udp.on('message', (msg, rinfo) => {
      if (msg.toString() !== 'IFT-search' || this.offline) return;
      this.udp!.send(JSON.stringify({ ip: this.host, mac: 'aa:bb:cc:dd:ee:ff', version: '1.2.3' }), rinfo.port, rinfo.address);
    });
    await new Promise<void>((r) => this.udp!.bind(0, '127.0.0.1', r));
    this.udpPort = (this.udp.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server?.close(() => r()));
    this.udp?.close();
  }

  get host(): string {
    return `127.0.0.1:${this.port}`;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.offline) {
      req.socket.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    if (req.url === '/poll') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(this.state));
      return;
    }
    if (req.url === '/get_challenge') {
      this.challenge = randomBytes(16).toString('hex').toUpperCase();
      this.challengeIssued = Date.now();
      res.writeHead(200, { 'content-type': 'text/plain' }).end(this.challenge);
      return;
    }
    if (req.url === '/post' && req.method === 'POST') {
      const form = new URLSearchParams(bodyText);
      const command = form.get('command') ?? '';
      const value = form.get('value') ?? '';
      const user = form.get('user') ?? '';
      const response = form.get('response') ?? '';
      if (!this.challenge || Date.now() - this.challengeIssued > this.challengeTtlMs) {
        res.writeHead(403).end('challenge expired');
        return;
      }
      const apiKey = Buffer.from(APIKEY, 'hex');
      const sig = createHash('sha256')
        .update(Buffer.concat([apiKey, Buffer.from(this.challenge, 'hex'), Buffer.from(`post:command=${command}&value=${value}`)]))
        .digest();
      const expected = createHash('sha256').update(Buffer.concat([apiKey, sig])).digest('hex');
      if (expected !== response || user !== USER_ID) {
        res.writeHead(403).end('bad signature');
        return;
      }
      this.challenge = '';
      this.commands.push({ command, value, user });
      this.applyCommand(command, Number(value));
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404).end();
  }

  private applyCommand(command: string, value: number): void {
    switch (command) {
      case 'power': this.state.power = value; break;
      case 'flame_height': this.state.height = value; break;
      case 'fan_speed': this.state.fanspeed = value; break;
      case 'light': this.state.light = value; break;
      case 'thermostat_setpoint': this.state.setpoint = value; this.state.thermostat = 1; break;
      case 'pilot': this.state.pilot = value; break;
      default: break;
    }
  }
}

export class FakeIftCloud {
  readonly posts: Array<{ serial: string; body: string }> = [];
  readonly cookies = { user: USER_ID, auth_cookie: 'DEADBEEF', web_client_id: 'CAFEBABE' };
  username = 'user@example.com';
  password = 'hunter2';
  state: Record<string, string> = {};
  private server: http.Server | undefined;
  port = 0;
  logins = 0;

  constructor(private readonly module?: FakeFireplaceModule) {}

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server?.close(() => r()));
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private authed(req: http.IncomingMessage): boolean {
    const c = req.headers.cookie ?? '';
    return c.includes(`user=${this.cookies.user}`) && c.includes(`auth_cookie=${this.cookies.auth_cookie}`);
  }

  private cloudState(): Record<string, string> {
    // Cloud mirrors the module's state but as strings, as iftapi does.
    const src: Record<string, unknown> = this.module ? { ...this.module.state } : this.state;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(src)) out[k] = Array.isArray(v) ? JSON.stringify(v) : String(v);
    return out;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (o: unknown, code = 200): void => {
      res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(o));
    };
    if (url.pathname === '/a//login' && req.method === 'POST') {
      const form = new URLSearchParams(bodyText);
      this.logins++;
      if (form.get('username') !== this.username || form.get('password') !== this.password) {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(204, {
        'set-cookie': [
          `user=${this.cookies.user}; Path=/`,
          `auth_cookie=${this.cookies.auth_cookie}; Path=/`,
          `web_client_id=${this.cookies.web_client_id}; Path=/`,
        ],
      }).end();
      return;
    }
    if (!this.authed(req)) {
      res.writeHead(401).end();
      return;
    }
    if (url.pathname === '/a//enumlocations') return json({ locations: [{ location_id: 'loc1', location_name: 'Home' }] });
    if (url.pathname === '/a//enumfireplaces') {
      return json({ fireplaces: [{ serial: SERIAL, apikey: APIKEY, name: 'Living Room', brand: 'H&H', power: '0' }] });
    }
    const m = /^\/a\/([^/]+)\/\/(apppoll|apppost)$/.exec(url.pathname);
    if (m && m[1] === SERIAL) {
      if (m[2] === 'apppoll') return json(this.cloudState());
      this.posts.push({ serial: m[1], body: bodyText });
      const form = new URLSearchParams(bodyText);
      for (const [k, v] of form) {
        const n = Number(v);
        if (this.module) {
          const map: Record<string, keyof ModuleState> = { power: 'power', height: 'height', fanspeed: 'fanspeed', light: 'light', setpoint: 'setpoint', pilot: 'pilot' };
          const key = map[k];
          if (key) (this.module.state as unknown as Record<string, number>)[key] = n;
        } else {
          this.state[k] = v;
        }
      }
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404).end();
  }
}
