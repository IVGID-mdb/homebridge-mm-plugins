/** Minimal logger surface used throughout the plugins; Homebridge's Logging satisfies it. */
export interface Log {
  debug(message: string, ...params: unknown[]): void;
  info(message: string, ...params: unknown[]): void;
  warn(message: string, ...params: unknown[]): void;
  error(message: string, ...params: unknown[]): void;
}

/** Prefix every line with a device name so multi-device logs stay readable. */
export function prefixed(log: Log, prefix: string): Log {
  const p = `[${prefix}] `;
  return {
    debug: (m, ...r) => log.debug(p + m, ...r),
    info: (m, ...r) => log.info(p + m, ...r),
    warn: (m, ...r) => log.warn(p + m, ...r),
    error: (m, ...r) => log.error(p + m, ...r),
  };
}

export const silentLog: Log = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
