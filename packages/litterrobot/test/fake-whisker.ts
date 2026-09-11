/**
 * In-process Whisker cloud: a Cognito InitiateAuth endpoint and a GraphQL endpoint that
 * understands the three operations the plugin uses. Robot payload fields mirror the real
 * getLitterRobot4ByUser response.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RobotData } from '../src/whisker-api.js';

export const SERIAL = 'LR4C123456';
export const USER_ID = 'b0f7d7c3-1111-2222-3333-444444444444';

export function robot(over: Partial<RobotData> = {}): RobotData {
  return {
    name: "M&M's Kitties",
    serial: SERIAL,
    unitId: 'unit-1',
    unitPowerStatus: 'ON',
    robotStatus: 'ROBOT_IDLE',
    robotCycleState: 'CYCLE_IDLE',
    robotCycleStatus: 'CYCLE_IDLE',
    catDetect: 'CAT_DETECT_CLEAR',
    isOnline: true,
    isOnboarded: true,
    isDFIFull: false,
    DFILevelPercent: 10,
    litterLevelPercentage: 0.62,
    litterLevelState: 'OPTIMAL',
    nightLightMode: 'AUTO',
    nightLightBrightness: 50,
    isBonnetRemoved: false,
    catWeight: 9.4,
    espFirmware: '1.1.50',
    picFirmwareVersion: '10021.2560.2.53',
    laserBoardFirmwareVersion: '4.0.65.4',
    sleepStatus: 'WAKE',
    wifiRssi: -55,
    odometerCleanCycles: 1234,
    ...over,
  };
}

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
}

export class FakeWhisker {
  robots: RobotData[] = [robot()];
  readonly commands: Array<{ serial: string; command: string; value: unknown; commandSource: unknown }> = [];
  readonly queries: string[] = [];
  username = 'cat@example.com';
  password = 'meow';
  logins = 0;
  refreshes = 0;
  /** When set, every GraphQL request fails with this status until cleared. */
  graphqlFailWith: number | undefined;
  private accessToken = 'access-1';
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

  get cognitoUrl(): string {
    return `http://127.0.0.1:${this.port}/cognito`;
  }

  get graphqlUrl(): string {
    return `http://127.0.0.1:${this.port}/graphql`;
  }

  /** Invalidate the current access token (simulates expiry server-side). */
  rotateToken(): void {
    this.accessToken = `access-${Math.random().toString(36).slice(2)}`;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
    const json = (o: unknown, code = 200): void => {
      res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(o));
    };
    if (req.url === '/cognito') {
      if (req.headers['x-amz-target'] !== 'AWSCognitoIdentityProviderService.InitiateAuth') return json({ __type: 'UnknownOperationException' }, 400);
      const params = body.AuthParameters as Record<string, string>;
      if (body.AuthFlow === 'USER_PASSWORD_AUTH') {
        this.logins++;
        if (params.USERNAME !== this.username || params.PASSWORD !== this.password) {
          return json({ __type: 'NotAuthorizedException', message: 'Incorrect username or password.' }, 400);
        }
      } else if (body.AuthFlow === 'REFRESH_TOKEN_AUTH') {
        this.refreshes++;
        if (params.REFRESH_TOKEN !== 'refresh-1') return json({ __type: 'NotAuthorizedException', message: 'Invalid Refresh Token' }, 400);
      } else {
        return json({ __type: 'InvalidParameterException' }, 400);
      }
      return json({
        AuthenticationResult: {
          AccessToken: this.accessToken,
          IdToken: jwt({ 'cognito:username': USER_ID, mid: USER_ID, sub: USER_ID, exp: Math.floor(Date.now() / 1000) + 3600 }),
          RefreshToken: body.AuthFlow === 'USER_PASSWORD_AUTH' ? 'refresh-1' : undefined,
          ExpiresIn: 3600,
          TokenType: 'Bearer',
        },
        ChallengeParameters: {},
      });
    }
    if (req.url === '/graphql') {
      if (this.graphqlFailWith) {
        res.writeHead(this.graphqlFailWith).end();
        return;
      }
      if (req.headers.authorization !== `Bearer ${this.accessToken}`) {
        res.writeHead(401).end('{"message":"Unauthorized"}');
        return;
      }
      const query = String(body.query ?? '');
      const vars = (body.variables ?? {}) as Record<string, unknown>;
      this.queries.push(query.split('(')[0]!.trim());
      if (query.includes('getLitterRobot4ByUser')) {
        if (vars.userId !== USER_ID) return json({ data: { getLitterRobot4ByUser: [] } });
        return json({ data: { getLitterRobot4ByUser: this.robots } });
      }
      if (query.includes('getLitterRobot4BySerial')) {
        return json({ data: { getLitterRobot4BySerial: this.robots.find((r) => r.serial === vars.serial) ?? null } });
      }
      if (query.includes('sendLitterRobot4Command')) {
        this.commands.push({ serial: String(vars.serial), command: String(vars.command), value: vars.value, commandSource: vars.commandSource });
        const r = this.robots.find((x) => x.serial === vars.serial);
        if (r) this.applyCommand(r, String(vars.command));
        return json({ data: { sendLitterRobot4Command: 'OK' } });
      }
      return json({ errors: [{ message: 'unknown operation' }] });
    }
    res.writeHead(404).end();
  }

  private applyCommand(r: RobotData, command: string): void {
    switch (command) {
      case 'powerOn': r.unitPowerStatus = 'ON'; r.robotStatus = 'ROBOT_IDLE'; break;
      case 'powerOff': r.unitPowerStatus = 'OFF'; r.robotStatus = 'ROBOT_POWER_OFF'; break;
      case 'cleanCycle': r.robotStatus = 'ROBOT_CLEAN'; break;
      case 'nightLightModeOff': r.nightLightMode = 'OFF'; break;
      case 'nightLightModeAuto': r.nightLightMode = 'AUTO'; break;
      case 'nightLightModeOn': r.nightLightMode = 'ON'; break;
      case 'shortResetPress': r.DFILevelPercent = 0; r.isDFIFull = false; break;
      default: break;
    }
  }
}
