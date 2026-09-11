/**
 * An in-process Bond Bridge: HTTP API v2 on a random port plus a BPUP UDP responder.
 * Shaped after the real responses captured from a BD-1000 (fw v4.34.1) with an RCF119v2 fan.
 */
import http from 'node:http';
import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';

export interface FakeDevice {
  info: Record<string, unknown>;
  properties: Record<string, unknown>;
  state: Record<string, unknown>;
}

export interface ActionLog {
  id: string;
  action: string;
  body: unknown;
}

export const RCF119_FAN: FakeDevice = {
  info: {
    name: 'Ceiling fan',
    type: 'CF',
    location: 'Living Room',
    template: 'RCF119v2',
    actions: [
      'DecreaseSpeed', 'DimMode', 'IncreaseSpeed', 'SetDirection', 'SetSpeed', 'StartDimmer', 'Stop',
      'ToggleDirection', 'ToggleLight', 'TogglePower', 'TurnLightOff', 'TurnLightOn', 'TurnOff', 'TurnOn',
    ],
  },
  properties: { max_speed: 3, trust_state: false },
  state: { power: 0, speed: 1, direction: 1, light: 0 },
};

export class FakeBond {
  readonly devices = new Map<string, FakeDevice>();
  readonly actions: ActionLog[] = [];
  readonly bondId = 'ZZTEST0001';
  token = 'secret-token';
  private server: http.Server | undefined;
  private udp: dgram.Socket | undefined;
  private subscribers = new Set<string>();
  port = 0;
  udpPort = 0;
  /** Fail every request with this status (to test error paths). */
  failWith: number | undefined;
  /** Hang requests (to test timeouts). */
  hang = false;
  unauthorizedCount = 0;

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as AddressInfo).port;
    this.udp = dgram.createSocket('udp4');
    this.udp.on('message', (msg, rinfo) => {
      const key = `${rinfo.address}:${rinfo.port}`;
      this.subscribers.add(key);
      this.udp!.send(JSON.stringify({ B: this.bondId }) + '\n', rinfo.port, rinfo.address);
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

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Simulate a state change observed by the bridge (e.g. from the Bond app) via BPUP. */
  pushState(id: string, patch: Record<string, unknown>): void {
    const d = this.devices.get(id)!;
    d.state = { ...d.state, ...patch };
    const msg = JSON.stringify({ B: this.bondId, t: `devices/${id}/state`, i: 'abc', s: 200, m: 0, f: 255, b: d.state }) + '\n';
    for (const key of this.subscribers) {
      const [addr, port] = key.split(':');
      this.udp!.send(msg, Number(port), addr);
    }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.hang) return;
    if (this.failWith) {
      res.writeHead(this.failWith).end();
      return;
    }
    if (req.headers['bond-token'] !== this.token) {
      this.unauthorizedCount++;
      res.writeHead(401).end(JSON.stringify({ _error_id: 401, _error_msg: 'unauthorized' }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const url = req.url ?? '';
    const json = (obj: unknown, code = 200) => {
      res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
    };
    if (url === '/v2/sys/version') {
      return json({ target: 'zermatt-2', fw_ver: 'v4.34.1', make: 'Olibra', model: 'BD-1000', bondid: this.bondId, api: 2 });
    }
    if (url === '/v2/devices') {
      const out: Record<string, unknown> = { _: 'abcd1234' };
      for (const id of this.devices.keys()) out[id] = { _: '00000000' };
      return json(out);
    }
    const m = /^\/v2\/devices\/([^/]+)(?:\/(state|properties|actions\/([A-Za-z]+)))?$/.exec(url);
    if (!m) return json({ _error_id: 404 }, 404);
    const d = this.devices.get(m[1]!);
    if (!d) return json({ _error_id: 404 }, 404);
    if (!m[2]) return json({ ...d.info, _: 'x', commands: undefined });
    if (m[2] === 'state') return json({ ...d.state, _: 'y' });
    if (m[2] === 'properties') return json({ ...d.properties, _: 'z' });
    const action = m[3]!;
    if (req.method !== 'PUT') return json({ _error_id: 405 }, 405);
    const body = bodyText ? JSON.parse(bodyText) : {};
    this.actions.push({ id: m[1]!, action, body });
    this.applyAction(d, action, body.argument);
    return json({ _: 'ok' });
  }

  /** Mimic Bond's belief-state updates for the actions we use. */
  private applyAction(d: FakeDevice, action: string, arg: unknown): void {
    const s = d.state;
    switch (action) {
      case 'TurnOn': s.power = 1; break;
      case 'TurnOff': s.power = 0; break;
      case 'TogglePower': s.power = s.power ? 0 : 1; break;
      case 'SetSpeed': s.speed = Number(arg); s.power = 1; break;
      case 'SetDirection': s.direction = Number(arg); break;
      case 'ToggleDirection': s.direction = s.direction === 1 ? -1 : 1; break;
      case 'TurnLightOn': s.light = 1; break;
      case 'TurnLightOff': s.light = 0; break;
      case 'ToggleLight': s.light = s.light ? 0 : 1; break;
      case 'SetBrightness': s.brightness = Number(arg); s.light = 1; break;
      case 'Open': s.open = 1; break;
      case 'Close': s.open = 0; break;
      case 'ToggleOpen': s.open = s.open ? 0 : 1; break;
      case 'SetPosition': s.position = Number(arg); break;
      default: break;
    }
  }
}
