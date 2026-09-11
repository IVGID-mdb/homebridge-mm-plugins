/**
 * Whisker (Litter-Robot 4) cloud API — the same endpoints the official app and pylitterbot use.
 *
 *  Auth:   AWS Cognito user pool, us-east-1, app client 4552ujeu3aic90nf8qn53levmn,
 *          USER_PASSWORD_AUTH → access/id/refresh tokens; REFRESH_TOKEN_AUTH to renew.
 *          Done with plain HTTPS (no AWS SDK): POST https://cognito-idp.us-east-1.amazonaws.com/
 *          with X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth.
 *  Data:   GraphQL at https://lr4.iothings.site/graphql, Authorization: Bearer <access token>.
 *          Query  getLitterRobot4ByUser(userId) — userId is the id token's cognito:username.
 *          Mutation sendLitterRobot4Command(input:{serial, command, value, commandSource}).
 *
 * Tokens are never logged.
 */
import { HttpError, requestJson } from '@mm/hb-core';
import type { Log } from '@mm/hb-core';
import { silentLog } from '@mm/hb-core';

export const COGNITO_URL = 'https://cognito-idp.us-east-1.amazonaws.com/';
export const COGNITO_CLIENT_ID = '4552ujeu3aic90nf8qn53levmn';
export const GRAPHQL_URL = 'https://lr4.iothings.site/graphql';
const USER_AGENT = 'homebridge-mm-litterrobot';

/** Command strings accepted by sendLitterRobot4Command (per pylitterbot). */
export const LR4Command = {
  CLEAN_CYCLE: 'cleanCycle',
  NIGHT_LIGHT_MODE_AUTO: 'nightLightModeAuto',
  NIGHT_LIGHT_MODE_OFF: 'nightLightModeOff',
  NIGHT_LIGHT_MODE_ON: 'nightLightModeOn',
  POWER_OFF: 'powerOff',
  POWER_ON: 'powerOn',
  SHORT_RESET_PRESS: 'shortResetPress',
  REQUEST_STATE: 'requestState',
} as const;
export type LR4CommandName = (typeof LR4Command)[keyof typeof LR4Command];

export interface RobotData {
  name: string;
  serial: string;
  unitId: string;
  unitPowerStatus?: string;
  robotStatus?: string;
  robotCycleState?: string;
  robotCycleStatus?: string;
  catDetect?: string;
  isOnline?: boolean;
  isOnboarded?: boolean;
  isDFIFull?: boolean;
  DFILevelPercent?: number;
  litterLevelPercentage?: number;
  litterLevelState?: string;
  nightLightMode?: string;
  nightLightBrightness?: number;
  isBonnetRemoved?: boolean;
  catWeight?: number;
  espFirmware?: string;
  picFirmwareVersion?: string;
  laserBoardFirmwareVersion?: string;
  sleepStatus?: string;
  wifiRssi?: number;
  odometerCleanCycles?: number;
  [k: string]: unknown;
}

export const ROBOT_FIELDS = [
  'name', 'serial', 'unitId', 'unitPowerStatus', 'robotStatus', 'robotCycleState', 'robotCycleStatus', 'catDetect',
  'isOnline', 'isOnboarded', 'isDFIFull', 'DFILevelPercent', 'litterLevelPercentage', 'litterLevelState',
  'nightLightMode', 'nightLightBrightness', 'isBonnetRemoved', 'catWeight', 'espFirmware', 'picFirmwareVersion',
  'laserBoardFirmwareVersion', 'sleepStatus', 'wifiRssi', 'odometerCleanCycles', 'isKeypadLockout', 'panelBrightnessHigh',
];

interface Tokens {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface WhiskerOptions {
  cognitoUrl?: string;
  graphqlUrl?: string;
  clientId?: string;
  timeoutMs?: number;
  log?: Log;
}

export class WhiskerAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhiskerAuthError';
  }
}

export class WhiskerApi {
  private tokens: Tokens | undefined;
  private userId: string | undefined;
  private readonly cognitoUrl: string;
  private readonly graphqlUrl: string;
  private readonly clientId: string;
  private readonly timeoutMs: number;
  private readonly log: Log;
  private loginPromise: Promise<void> | undefined;

  constructor(
    private readonly username: string,
    private readonly password: string,
    opts: WhiskerOptions = {},
  ) {
    this.cognitoUrl = opts.cognitoUrl ?? COGNITO_URL;
    this.graphqlUrl = opts.graphqlUrl ?? GRAPHQL_URL;
    this.clientId = opts.clientId ?? COGNITO_CLIENT_ID;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.log = opts.log ?? silentLog;
  }

  get currentUserId(): string | undefined {
    return this.userId;
  }

  async listRobots(): Promise<RobotData[]> {
    await this.ensureAuth();
    const query = `query GetLR4($userId: String!) { getLitterRobot4ByUser(userId: $userId) { ${ROBOT_FIELDS.join(' ')} } }`;
    const data = await this.graphql<{ getLitterRobot4ByUser?: RobotData[] }>(query, { userId: this.userId });
    const robots = data.getLitterRobot4ByUser ?? [];
    return robots.filter((r) => r && typeof r.serial === 'string');
  }

  async getRobot(serial: string): Promise<RobotData | undefined> {
    await this.ensureAuth();
    const query = `query GetLR4($serial: String!) { getLitterRobot4BySerial(serial: $serial) { ${ROBOT_FIELDS.join(' ')} } }`;
    const data = await this.graphql<{ getLitterRobot4BySerial?: RobotData }>(query, { serial });
    return data.getLitterRobot4BySerial ?? undefined;
  }

  async sendCommand(serial: string, command: LR4CommandName, value?: string): Promise<void> {
    await this.ensureAuth();
    const mutation =
      'mutation sendCommand($serial: String!, $command: String!, $value: String, $commandSource: String) ' +
      '{ sendLitterRobot4Command(input: {serial: $serial, command: $command, value: $value, commandSource: $commandSource}) }';
    await this.graphql(mutation, { serial, command, value: value ?? null, commandSource: 'homebridge' });
  }

  // ---- auth ---------------------------------------------------------------------------------

  private async ensureAuth(): Promise<void> {
    if (this.tokens && Date.now() < this.tokens.expiresAt - 60_000) return;
    if (!this.loginPromise) {
      this.loginPromise = (async () => {
        if (this.tokens?.refreshToken) {
          try {
            await this.cognito({ AuthFlow: 'REFRESH_TOKEN_AUTH', AuthParameters: { REFRESH_TOKEN: this.tokens.refreshToken } });
            this.log.debug('Whisker token refreshed');
            return;
          } catch (err) {
            this.log.warn(`Whisker token refresh failed, logging in again: ${(err as Error).message}`);
          }
        }
        await this.cognito({ AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: this.username, PASSWORD: this.password } });
        this.log.info('Whisker login ok');
      })().finally(() => (this.loginPromise = undefined));
    }
    await this.loginPromise;
  }

  private async cognito(body: { AuthFlow: string; AuthParameters: Record<string, string> }): Promise<void> {
    let res: {
      AuthenticationResult?: { AccessToken?: string; IdToken?: string; RefreshToken?: string; ExpiresIn?: number };
      ChallengeName?: string;
    };
    try {
      res = await requestJson(this.cognitoUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth',
          'user-agent': USER_AGENT,
        },
        body: { ...body, ClientId: this.clientId },
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 400) {
        let msg = 'Cognito rejected the credentials';
        try {
          const j = JSON.parse(err.body ?? '{}') as { message?: string; __type?: string };
          msg = `${j.__type ?? 'Cognito error'}: ${j.message ?? ''}`.trim();
        } catch {
          /* keep generic */
        }
        throw new WhiskerAuthError(msg);
      }
      throw err;
    }
    const r = res.AuthenticationResult;
    if (!r?.AccessToken || !r.IdToken) {
      throw new WhiskerAuthError(`Cognito did not return tokens${res.ChallengeName ? ` (challenge ${res.ChallengeName})` : ''}`);
    }
    this.tokens = {
      accessToken: r.AccessToken,
      idToken: r.IdToken,
      refreshToken: r.RefreshToken ?? this.tokens?.refreshToken,
      expiresAt: Date.now() + (r.ExpiresIn ?? 3600) * 1000,
    };
    const claims = decodeJwt(r.IdToken);
    this.userId = (claims['cognito:username'] as string | undefined) ?? (claims.mid as string | undefined) ?? (claims.sub as string | undefined);
    if (!this.userId) throw new WhiskerAuthError('id token has no user id claim');
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>, retried = false): Promise<T> {
    let res: { data?: T; errors?: Array<{ message?: string }> };
    try {
      res = await requestJson(this.graphqlUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.tokens!.accessToken}`,
          'user-agent': USER_AGENT,
        },
        body: { query, variables },
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 401 && !retried) {
        this.log.debug('GraphQL 401, re-authenticating once');
        // Expire the access token but keep the refresh token so we renew instead of re-logging in.
        this.tokens = this.tokens ? { ...this.tokens, expiresAt: 0 } : undefined;
        await this.ensureAuth();
        return this.graphql<T>(query, variables, true);
      }
      throw err;
    }
    if (res.errors?.length) {
      throw new Error(`GraphQL: ${res.errors.map((e) => e.message ?? 'error').join('; ')}`);
    }
    return (res.data ?? {}) as T;
  }
}

export function decodeJwt(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  try {
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}
