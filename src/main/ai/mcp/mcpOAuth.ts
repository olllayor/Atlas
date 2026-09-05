import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';

import type {
  AuthResult,
  OAuthClientProvider,
  OAuthDiscoveryState
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js';

/**
 * OAuth for remote MCP servers, per the MCP authorization spec.
 *
 * A remote server that answers `401` is not broken — it is asking to be
 * authorized. The SDK drives the whole flow (RFC 9728 discovery, dynamic
 * client registration, PKCE, token exchange, refresh) against this class;
 * what Atlas supplies is the parts only a desktop app can: a browser to
 * consent in, a loopback port to land back on, and a keychain to keep the
 * tokens in.
 *
 * The client is public by construction: no secret ships with the app, so
 * authorization rests on PKCE plus the loopback redirect, which is exactly
 * what OAuth 2.1 prescribes for native applications.
 */

/** Where the provider keeps its state. Keychain in production, memory in tests. */
export type OAuthStateStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

export type McpOAuthOptions = {
  /** Stable per server — the storage namespace and the loopback state key. */
  serverId: string;
  /** Human-readable name sent during dynamic client registration. */
  serverName: string;
  store: OAuthStateStore;
  /** Opens the consent page. Electron `shell.openExternal` in production. */
  openExternal: (url: string) => void | Promise<void>;
  /** Loopback listener port; 0 (ephemeral) unless a test pins one. */
  port?: number;
  /** How long the callback server waits for the browser to come back. */
  callbackTimeoutMs?: number;
};

const DEFAULT_CALLBACK_TIMEOUT_MS = 5 * 60_000;

/** One JSON blob per kind of state, namespaced by server. */
const keyFor = (serverId: string, kind: string): string => `mcp-oauth:${serverId}:${kind}`;

async function readJson<T>(store: OAuthStateStore, key: string): Promise<T | undefined> {
  const raw = await store.get(key);
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    // A blob that will not parse is treated as absent rather than fatal: the
    // flow re-registers and re-authorizes, which is the correct recovery.
    return undefined;
  }
}

export class McpOAuthProvider implements OAuthClientProvider {
  private readonly store: OAuthStateStore;
  private listener: HttpServer | null = null;
  private listenPort: number | null = null;
  /**
   * The state this provider last generated.
   *
   * The SDK's `auth()` calls `state()` itself and embeds the value in the
   * authorization URL, so the expected state is recorded at generation time
   * and checked when the landing arrives — not when the wait starts.
   */
  private expectedState: string | null = null;
  private pending: {
    resolve: (url: URL) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private readonly callbackTimeoutMs: number;

  constructor(
    private readonly options: McpOAuthOptions,
    /** Overridden by tests that drive the callback by hand. */
    private readonly listen: (server: HttpServer, port: number) => Promise<number> = (server, port) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          const address = server.address();
          if (address && typeof address === 'object') {
            resolve(address.port);
          } else {
            reject(new Error('The OAuth callback listener has no port.'));
          }
        });
      })
  ) {
    this.store = options.store;
    this.callbackTimeoutMs = options.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS;
  }

  get redirectUrl(): string {
    return `http://127.0.0.1:${this.listenPort ?? this.options.port ?? 0}/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `Atlas — ${this.options.serverName}`,
      client_uri: 'https://atlas.local',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    };
  }

  state(): string {
    const value = randomBytes(16).toString('hex');
    this.expectedState = value;
    return value;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return readJson(this.store, keyFor(this.options.serverId, 'client'));
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    await this.store.set(keyFor(this.options.serverId, 'client'), JSON.stringify(info));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return readJson(this.store, keyFor(this.options.serverId, 'tokens'));
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.store.set(keyFor(this.options.serverId, 'tokens'), JSON.stringify(tokens));
  }

  async codeVerifier(): Promise<string> {
    const verifier = await this.store.get(keyFor(this.options.serverId, 'verifier'));

    if (!verifier) {
      throw new Error('The OAuth code verifier is missing — the authorization round trip lost its state.');
    }

    return verifier;
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    await this.store.set(keyFor(this.options.serverId, 'verifier'), verifier);
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return readJson(this.store, keyFor(this.options.serverId, 'discovery'));
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.store.set(keyFor(this.options.serverId, 'discovery'), JSON.stringify(state));
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    const kinds =
      scope === 'all'
        ? ['client', 'tokens', 'verifier', 'discovery']
        : [scope === 'client' ? 'client' : scope === 'tokens' ? 'tokens' : scope === 'verifier' ? 'verifier' : 'discovery'];

    for (const kind of kinds) {
      await this.store.remove(keyFor(this.options.serverId, kind));
    }
  }

  /**
   * Opens the consent page and waits for the loopback landing.
   *
   * The listener starts here rather than at construction: an ephemeral port
   * must be bound before `redirectUrl` is honest, and `redirectUrl` is read
   * during client registration — after this method is entered, before the
   * browser opens.
   */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.ensureListener();
    this.openExternal(String(authorizationUrl));
  }

  /** Resolves with the full callback URL, or rejects on timeout or bad state. */
  waitForCallback(): Promise<URL> {
    this.cancelWait();

    return new Promise<URL>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('The authorization did not come back in time. Start again when ready.'));
      }, this.callbackTimeoutMs);

      this.pending = { resolve, reject, timer };
    });
  }

  /** Stops the loopback listener, if one is running. */
  close(): void {
    this.cancelWait();
    this.listener?.close();
    this.listener = null;
    this.listenPort = null;
  }

  /** Abandons a pending callback wait without touching the listener. */
  cancelWait(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Authorization cancelled.'));
      this.pending = null;
    }
  }

  private async ensureListener(): Promise<void> {
    if (this.listener) {
      return;
    }

    const server = createServer((request, response) => {
      void this.handleCallback(request, response);
    });

    this.listenPort = await this.listen(server, this.options.port ?? 0);
    this.listener = server;
  }

  private handleCallback(request: IncomingMessage, response: ServerResponse): void {
    const finish = (status: number, body: string): void => {
      response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
      response.end(body);
    };

    const url = new URL(request.url ?? '/', `http://127.0.0.1:${this.listenPort}`);

    if (url.pathname !== '/callback') {
      finish(404, '<html><body>Not found</body></html>');
      return;
    }

    const error = url.searchParams.get('error');
    const pending = this.pending;

    // The page the user lands on says something either way; the SDK reads the
    // query parameters from the resolved URL, not from this HTML.
    finish(
      error ? 400 : 200,
      error
        ? `<html><body><h2>Atlas — authorization failed</h2><p>${escapeHtml(error)}</p><p>You can close this tab.</p></body></html>`
        : '<html><body><h2>Atlas — authorized</h2><p>You can close this tab and return to the app.</p></body></html>'
    );

    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending = null;

    const state = url.searchParams.get('state');

    if (this.expectedState && state !== this.expectedState) {
      pending.reject(new Error('The authorization response carried a state that does not match. Nothing was authorized.'));
      return;
    }

    pending.resolve(url);
  }

  private openExternal(url: string): void {
    void this.options.openExternal(url);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * Drives one authorization round trip to completion.
 *
 * The SDK's `auth()` performs discovery, registers the client, opens the
 * browser and returns `REDIRECT`; the consent landing arrives on the loopback
 * port, and a second `auth()` call with the landing's code exchanges it for
 * tokens. Everything else — PKCE, verifier storage, state — is the provider's.
 */
export async function completeAuthorization(
  provider: OAuthClientProvider & {
    waitForCallback(): Promise<URL>;
    cancelWait(): void;
  },
  runAuth: (options: { authorizationCode?: string }) => Promise<AuthResult>
): Promise<'ready' | 'authorization-required'> {
  // Armed before `runAuth`: the SDK generates its state through this provider
  // mid-flow, and the landing is checked against whatever it generated.
  const landing = provider.waitForCallback();
  // Prevent unhandled rejection when we cancel the wait early (already-authorized path).
  landing.catch(() => {});

  const first = await runAuth({});

  if (first !== 'REDIRECT') {
    // Already authorized — a token was refreshed or one was still valid.
    provider.cancelWait();
    return 'ready';
  }

  const callback = await landing;
  const error = callback.searchParams.get('error');

  if (error) {
    throw new Error(`The authorization failed: ${error}`);
  }

  const code = callback.searchParams.get('code');

  if (!code) {
    throw new Error('The authorization came back without a code.');
  }

  const second = await runAuth({ authorizationCode: code });

  return second === 'AUTHORIZED' ? 'ready' : 'authorization-required';
}
