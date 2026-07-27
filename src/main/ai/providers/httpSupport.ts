import { HttpStatusError, parseRetryAfterMs } from '../core/ErrorNormalizer';

/**
 * Raises a status error that carries the provider's own backoff hint, so the
 * retry layer can honour Retry-After instead of inventing a delay.
 */
export async function throwForBadResponse(response: Response) {
  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => '');
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  throw new HttpStatusError(response.status, body || response.statusText, parseRetryAfterMs(headers));
}

export type FetchJsonOptions = {
  timeoutMs: number;
  headers: Record<string, string>;
  signal?: AbortSignal;
  method?: string;
  body?: string;
};

export type FetchJsonResult<T> = {
  status: number;
  data: T | null;
  headers: Headers;
};

/**
 * Fetch with a bounded timeout that does not leak the timer when the caller's
 * own signal fires first.
 */
export async function fetchWithTimeout(url: string, options: FetchJsonOptions) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  timeout.unref?.();

  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;

  try {
    return await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Memoises SDK clients per credential. Rebuilding one on every turn allocated a
 * fresh HTTP configuration for no benefit.
 */
export function createClientCache<TClient>(factory: (apiKey: string) => TClient) {
  let cachedKey: string | null = null;
  let cachedClient: TClient | null = null;

  return (apiKey: string): TClient => {
    if (cachedClient && cachedKey === apiKey) {
      return cachedClient;
    }

    cachedKey = apiKey;
    cachedClient = factory(apiKey);
    return cachedClient;
  };
}
