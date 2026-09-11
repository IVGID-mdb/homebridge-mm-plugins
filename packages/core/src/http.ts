/**
 * Tiny fetch wrapper: hard timeout, typed JSON, and a structured error so accessory code
 * can distinguish "device unreachable" from "device rejected the request".
 */
export type HttpErrorKind = 'timeout' | 'network' | 'status' | 'parse';

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly status: number | undefined,
    public readonly kind: HttpErrorKind,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  /** Object → JSON body; string → sent as-is; URLSearchParams → form body. */
  body?: unknown;
  timeoutMs?: number;
  /** Accept these non-2xx statuses without throwing (e.g. 304). */
  okStatuses?: number[];
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  text: string;
}

export async function request(url: string, opts: RequestOptions = {}): Promise<HttpResponse> {
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 5000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  let body: string | URLSearchParams | undefined;
  if (opts.body instanceof URLSearchParams || typeof opts.body === 'string') {
    body = opts.body;
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json';
    }
  }
  try {
    const res = await fetch(url, { method: opts.method ?? 'GET', headers, body, signal: controller.signal });
    const text = await res.text();
    if (!res.ok && !(opts.okStatuses ?? []).includes(res.status)) {
      throw new HttpError(`HTTP ${res.status} from ${url}`, url, res.status, 'status', text.slice(0, 500));
    }
    return { status: res.status, headers: res.headers, text };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const e = err as Error & { cause?: { code?: string } };
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new HttpError(`Timeout after ${timeoutMs}ms: ${url}`, url, undefined, 'timeout');
    }
    const code = e.cause?.code ? ` (${e.cause.code})` : '';
    throw new HttpError(`Network error${code}: ${url}: ${e.message}`, url, undefined, 'network');
  } finally {
    clearTimeout(timer);
  }
}

export async function requestJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await request(url, opts);
  try {
    return JSON.parse(res.text) as T;
  } catch {
    throw new HttpError(`Invalid JSON from ${url}`, url, res.status, 'parse', res.text.slice(0, 200));
  }
}
