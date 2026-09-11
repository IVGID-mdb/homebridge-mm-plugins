/** In-process Modern Forms fan: POST /mf, replies shaped like the real bedroom fan. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export class FakeModernFormsFan {
  state: Record<string, unknown> = {
    clientId: 'MF_FCE8C0850234',
    cloudPort: 8883,
    lightOn: false,
    fanOn: true,
    lightBrightness: 100,
    fanSpeed: 1,
    fanDirection: 'forward',
    wind: false,
    windSpeed: 2,
    rfPairModeActive: false,
    resetRfPairList: false,
    factoryReset: false,
    awayModeEnabled: false,
    fanTimer: 0,
    lightTimer: 0,
    decommission: false,
    schedule: '',
    adaptiveLearning: false,
    userData: 'local_wifi',
    timezone: 'PST8PDT',
    cdebug: false,
    feedbackToneMute: false,
  };
  info: Record<string, unknown> = {
    clientId: 'MF_FCE8C0850234',
    mac: 'FC:E8:C0:85:02:34',
    deviceName: 'Bedroom Fan',
    fanType: 'Wynd',
    firmwareVersion: '01.03.0067',
    lightType: 'LED',
    productSKU: 'FR-W1801',
  };
  readonly sets: Array<Record<string, unknown>> = [];
  failWith: number | undefined;
  private server: http.Server | undefined;
  port = 0;

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server?.close(() => r()));
  }

  get host(): string {
    return `127.0.0.1:${this.port}`;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.failWith) {
      res.writeHead(this.failWith).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
    if (req.url !== '/mf' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    let reply: Record<string, unknown>;
    if (body.queryStaticShadowData) {
      reply = this.info;
    } else if (body.queryDynamicShadowData) {
      reply = this.state;
    } else {
      this.sets.push(body);
      this.state = { ...this.state, ...body };
      reply = this.state;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply));
  }
}
