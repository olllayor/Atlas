/**
 * Per-instance Antigravity sign-in flow, ported from t3code PR #9348
 * (`apps/server/src/provider/AntigravityAuth.ts`) to plain Node TS.
 *
 * Same method: start a disposable runtime with an `onAuthorizationUrl` hook,
 * expose the OAuth URL, validate + forward the loopback callback, then confirm
 * authentication. A controlled BROWSER helper + stdout prefix filter (in the
 * ACP transport) catches the URL; the profile is per-instance (`GEMINI_HOME`).
 */

import { randomUUID } from 'node:crypto';

import {
  ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE,
  antigravityAuthUsesBrowser,
  parseAntigravityAuthorizationUrl,
  type AntigravityAuthConfig,
  type AntigravityAuthorizationUrl
} from './antigravityAuthSupport.js';
import {
  forwardAntigravityCallback,
  validateAntigravityCallbackUrl
} from './antigravityCallback.js';

export type AntigravityAuthStatus =
  | { state: 'idle' }
  | { state: 'awaiting-callback'; flowId: string; authorizationUrl: string; expiresAt: string }
  | { state: 'verifying'; flowId: string }
  | { state: 'authenticated'; authenticatedAt: string }
  | { state: 'error'; message: string };

export interface AntigravityAuthFlow {
  readonly flowId: string;
  readonly authorizationUrl: AntigravityAuthorizationUrl;
  readonly expiresAt: string;
}

export interface AntigravityAuthDeps {
  /** Start a disposable agent process that reports its OAuth URL. */
  readonly startAgent: (hooks: {
    onAuthorizationUrl: (url: string) => void;
  }) => Promise<{ stop: () => Promise<void> }>;
  /** Confirm the agent authenticated (e.g. ACP initialize/session/new). */
  readonly confirmAuthenticated: () => Promise<void>;
  /** Clear the native provider credentials during explicit sign-out. */
  readonly logoutAgent?: () => Promise<void>;
  readonly now?: () => number;
  readonly flowTtlMs?: number;
}

const DEFAULT_FLOW_TTL_MS = 5 * 60_000;

export class AntigravityAuth {
  private status: AntigravityAuthStatus = { state: 'idle' };
  private pending: {
    flow: AntigravityAuthFlow;
    stop: () => Promise<void>;
    timer: NodeJS.Timeout;
  } | null = null;
  private authenticatedAt: string | null = null;

  constructor(
    private readonly auth: AntigravityAuthConfig,
    private readonly deps: AntigravityAuthDeps
  ) {}

  getStatus(): AntigravityAuthStatus {
    if (this.authenticatedAt) {
      return { state: 'authenticated', authenticatedAt: this.authenticatedAt };
    }
    return this.status;
  }

  usesBrowser(): boolean {
    return antigravityAuthUsesBrowser(this.auth.authMethod);
  }

  /** Begin sign-in. Non-browser methods verify stored credentials instead. */
  async start(): Promise<AntigravityAuthStatus> {
    if (this.pending) {
      return this.status;
    }
    if (!this.usesBrowser()) {
      // Connect without a browser: fail loudly when credentials are missing
      // without spawning a process, like T3's setup card.
      try {
        await this.deps.confirmAuthenticated();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? '');
        this.status = { state: 'error', message: message || 'Missing credential.' };
        return this.status;
      }
      this.authenticatedAt = new Date(this.deps.now?.() ?? Date.now()).toISOString();
      this.status = { state: 'authenticated', authenticatedAt: this.authenticatedAt };
      return this.status;
    }

    const ttlMs = this.deps.flowTtlMs ?? DEFAULT_FLOW_TTL_MS;
    const now = this.deps.now?.() ?? Date.now();
    let captured: AntigravityAuthorizationUrl | null = null;
    let captureError: string | null = null;
    const handle = await this.deps.startAgent({
      onAuthorizationUrl: (url) => {
        let parsed: AntigravityAuthorizationUrl;
        try {
          parsed = parseAntigravityAuthorizationUrl(url);
        } catch {
          // Ignore malformed URLs; the agent may print others first.
          return;
        }
        if (captured && captured.authorizationUrl !== parsed.authorizationUrl) {
          captureError = 'Antigravity started more than one Google sign-in request.';
          throw new Error(captureError);
        }
        captured = parsed;
      }
    });

    // The agent prints the URL shortly after start; poll briefly.
    const deadline = Date.now() + 30_000;
    while (!captured && !captureError && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (captureError) {
      await handle.stop().catch(() => undefined);
      this.status = { state: 'error', message: captureError };
      return this.status;
    }
    if (!captured) {
      await handle.stop().catch(() => undefined);
      this.status = { state: 'error', message: 'The agent did not print a sign-in URL.' };
      return this.status;
    }
    const flow: AntigravityAuthFlow = {
      flowId: randomUUID(),
      authorizationUrl: (captured as AntigravityAuthorizationUrl | null)!,
      expiresAt: new Date(now + ttlMs).toISOString()
    };
    const timer = setTimeout(() => {
      void this.cancel().catch(() => undefined);
    }, ttlMs);
    timer.unref?.();
    this.pending = { flow, stop: handle.stop, timer };
    this.status = {
      state: 'awaiting-callback',
      flowId: flow.flowId,
      authorizationUrl: flow.authorizationUrl.authorizationUrl,
      expiresAt: flow.expiresAt
    };
    return this.status;
  }

  /** Complete sign-in with the pasted `127.0.0.1` redirect URL. */
  async complete(callbackUrl: string): Promise<AntigravityAuthStatus> {
    const pending = this.pending;
    if (!pending) {
      throw new Error(ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE);
    }
    this.status = { state: 'verifying', flowId: pending.flow.flowId };
    try {
      const result = validateAntigravityCallbackUrl(
        {
          redirectUri: pending.flow.authorizationUrl.redirectUri,
          state: pending.flow.authorizationUrl.state
        },
        callbackUrl
      );
      if (result.error) {
        throw new Error('Google sign-in was not approved.');
      }
      await forwardAntigravityCallback(callbackUrl);
      await this.deps.confirmAuthenticated();
      this.authenticatedAt = new Date(this.deps.now?.() ?? Date.now()).toISOString();
      await this.cleanupPending();
      this.status = { state: 'authenticated', authenticatedAt: this.authenticatedAt };
      return this.status;
    } catch (error) {
      await this.cleanupPending();
      const message = error instanceof Error ? error.message : String(error ?? '');
      this.status = { state: 'error', message: message || 'Sign-in failed.' };
      return this.status;
    }
  }

  async cancel(): Promise<AntigravityAuthStatus> {
    await this.cleanupPending();
    if (!this.authenticatedAt) {
      this.status = { state: 'idle' };
    }
    return this.getStatus();
  }

  async logout(): Promise<AntigravityAuthStatus> {
    await this.cleanupPending();
    this.authenticatedAt = null;
    if (this.deps.logoutAgent) {
      try {
        await this.deps.logoutAgent();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? '');
        this.status = { state: 'error', message: message || 'Sign-out failed.' };
        return this.status;
      }
    }
    this.status = { state: 'idle' };
    return this.status;
  }

  private async cleanupPending(): Promise<void> {
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      await pending.stop().catch(() => undefined);
    }
  }
}
