/**
 * OAuth loopback callback helpers, ported from t3code PR #9348
 * (`apps/server/src/provider/antigravityCallback.ts`).
 *
 * Flow: the agent prints a Google OAuth URL whose `redirect_uri` is a
 * `http://127.0.0.1:<port>/` loopback address. On the host machine the
 * redirect finishes on its own; from a phone or another computer the user
 * pastes the failed `127.0.0.1` redirect URL into the setup card. Either way
 * the callback is forwarded to the loopback server with a plain GET.
 */

import { request as httpRequest } from 'node:http';

export interface AntigravityPendingCallback {
  readonly redirectUri: string;
  readonly state: string;
}

const MAX_CALLBACK_URL_LENGTH = 16_384;

function fail(detail: string): never {
  throw new Error(detail);
}

/**
 * Validate a pasted or redirected OAuth callback URL against the pending flow.
 * Accepts exactly one `code` xor one `error`, matching `state`.
 */
export function validateAntigravityCallbackUrl(
  pending: AntigravityPendingCallback,
  rawUrl: string
): { code?: string; error?: string } {
  if (!rawUrl || rawUrl.length > MAX_CALLBACK_URL_LENGTH || /\s/.test(rawUrl)) {
    fail('That callback URL does not look like a Google sign-in redirect.');
  }
  let pendingRedirect: URL;
  let callback: URL;
  try {
    pendingRedirect = new URL(pending.redirectUri);
    callback = new URL(rawUrl);
  } catch {
    fail('That callback URL does not look like a Google sign-in redirect.');
  }
  if (callback!.origin !== pendingRedirect!.origin || callback!.pathname !== pendingRedirect!.pathname) {
    fail('That callback URL is for a different sign-in attempt. Start a fresh sign-in and paste its redirect.');
  }
  const states = callback!.searchParams.getAll('state');
  if (states.length !== 1 || states[0] !== pending.state) {
    fail('That callback URL is for a different sign-in attempt. Start a fresh sign-in and paste its redirect.');
  }
  const codes = callback!.searchParams.getAll('code');
  const errors = callback!.searchParams.getAll('error');
  const iss = callback!.searchParams.getAll('iss');
  if (iss.length > 1 || (iss.length === 1 && iss[0] !== 'https://accounts.google.com')) {
    fail('That callback URL does not look like a Google sign-in redirect.');
  }
  const hasCode = codes.length === 1 && (codes[0] ?? '').length > 0;
  const hasError = errors.length === 1 && (errors[0] ?? '').length > 0;
  if (hasCode === hasError) {
    fail('That callback URL carries no usable sign-in result. Approve the Google consent screen, then paste the redirect URL.');
  }
  return {
    ...(hasCode ? { code: codes[0]! } : {}),
    ...(hasError ? { error: errors[0]! } : {})
  };
}

/**
 * Forward the callback to the agent's loopback server. Raw `node:http`, no
 * proxy, no redirects, no logging of the URL (it carries the code).
 */
export function forwardAntigravityCallback(
  callbackUrl: string,
  options?: { timeoutMs?: number }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(callbackUrl);
    } catch {
      reject(new Error('That callback URL does not look like a Google sign-in redirect.'));
      return;
    }
    if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')) {
      reject(new Error('Refusing to forward a callback that is not a loopback URL.'));
      return;
    }
    const req = httpRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        agent: false,
        timeout: timeoutMs
      },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          resolve();
        } else {
          reject(new Error(`The sign-in callback was rejected (HTTP ${status}).`));
        }
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('Timed out forwarding the sign-in callback.'));
    });
    req.on('error', (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    req.end();
  });
}
