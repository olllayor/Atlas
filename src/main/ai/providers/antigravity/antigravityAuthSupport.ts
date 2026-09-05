/**
 * Antigravity auth + spawn support, ported from t3code PR #9348
 * (`apps/server/src/provider/antigravityAuthSupport.ts`) to plain Node TS.
 *
 * Same method T3 uses:
 * - each instance gets its own `GEMINI_HOME` profile with file token storage;
 * - a controlled `BROWSER` helper stops the agent opening a browser on the
 *   host, so the OAuth URL is captured from a marker line instead;
 * - the agent prints its OAuth URL as one plain stdout line with an exact
 *   prefix, caught by a stdout filter (wired in `AntigravityAuth`);
 * - 4 auth methods: Google account (default), Gemini Enterprise, Gemini API
 *   key, Agent Platform. No fallback from the picked method.
 * - ambient `GOOGLE_*` variables on the host are stripped; only the picked
 *   method's credential reaches the agent.
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const ANTIGRAVITY_AUTH_STDOUT_PREFIX =
  'Open the following link to authenticate the ACP server: ';
export const ANTIGRAVITY_AUTH_BROWSER_MARKER = '__ATLAS_ANTIGRAVITY_AUTH_URL__';
export const ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE =
  'Sign in to Antigravity in Settings before you continue.';

export type AntigravityAuthMethod =
  | 'oauth-personal'
  | 'oauth-business'
  | 'gemini-api-key'
  | 'agent-platform';

export const ANTIGRAVITY_AUTH_METHODS: readonly AntigravityAuthMethod[] = [
  'oauth-personal',
  'oauth-business',
  'gemini-api-key',
  'agent-platform'
];

export function isAntigravityAuthMethod(value: unknown): value is AntigravityAuthMethod {
  return (
    value === 'oauth-personal' ||
    value === 'oauth-business' ||
    value === 'gemini-api-key' ||
    value === 'agent-platform'
  );
}

/** Credentials for the non-personal ACP auth methods. Empty means "not set". */
export interface AntigravityAuthConfig {
  readonly authMethod: AntigravityAuthMethod;
  readonly apiKey: string;
  readonly gcpProject: string;
  readonly gcpLocation: string;
}

export const ANTIGRAVITY_PERSONAL_AUTH: AntigravityAuthConfig = {
  authMethod: 'oauth-personal',
  apiKey: '',
  gcpProject: '',
  gcpLocation: ''
};

/** True for the two methods that open a Google sign-in page. */
export function antigravityAuthUsesBrowser(authMethod: AntigravityAuthMethod): boolean {
  return authMethod === 'oauth-personal' || authMethod === 'oauth-business';
}

export function antigravityAuthLabel(authMethod: AntigravityAuthMethod): string {
  switch (authMethod) {
    case 'oauth-personal':
      return 'Google account';
    case 'oauth-business':
      return 'Gemini Enterprise';
    case 'gemini-api-key':
      return 'Gemini API key';
    case 'agent-platform':
      return 'Agent Platform';
  }
}

/** What is missing before a non-personal method can authenticate, else null. */
export function antigravityAuthConfigIssue(auth: AntigravityAuthConfig): string | null {
  switch (auth.authMethod) {
    case 'oauth-personal':
      return null;
    case 'oauth-business':
      return auth.gcpProject && auth.gcpLocation
        ? null
        : 'Gemini Enterprise needs a GCP project and location in the Antigravity settings.';
    case 'gemini-api-key':
      return auth.apiKey ? null : 'Enter a Gemini API key in the Antigravity settings.';
    case 'agent-platform':
      return auth.apiKey || (auth.gcpProject && auth.gcpLocation)
        ? null
        : 'Agent Platform needs an API key, or a GCP project and location, in the Antigravity settings.';
  }
}

/**
 * `settings.json` content for the agent profile. `auth.type` names the
 * selected method so a native logout clears only that method's credentials.
 * Never holds a secret.
 */
export function antigravityProfileSettings(auth: AntigravityAuthConfig): string {
  const payload: { auth: { type: string }; gcp?: { project?: string; location?: string } } = {
    auth: { type: auth.authMethod }
  };
  if (auth.gcpProject || auth.gcpLocation) {
    payload.gcp = {
      ...(auth.gcpProject ? { project: auth.gcpProject } : {}),
      ...(auth.gcpLocation ? { location: auth.gcpLocation } : {})
    };
  }
  return `${JSON.stringify(payload)}\n`;
}

export interface AntigravityProfile {
  readonly platform: NodeJS.Platform;
  readonly geminiHome: string;
  readonly acpDirectory: string;
  readonly tokenPath: string;
  readonly browserCommand: string;
}

/** Keeps case-sensitive instance ids separate on case-insensitive filesystems. */
export function resolveAntigravityProfileDirectory(stateDir: string, instanceId: string): string {
  const directoryName = createHash('sha256').update(instanceId).digest('hex');
  return join(stateDir, 'providers', 'antigravity', directoryName);
}

export function resolveAntigravityProfilePaths(profileDirectory: string, platform: NodeJS.Platform): {
  geminiHome: string;
  acpDirectory: string;
  tokenPath: string;
} {
  const geminiHome = profileDirectory;
  const acpDirectory = join(geminiHome, 'antigravity-acp');
  return { geminiHome, acpDirectory, tokenPath: join(acpDirectory, 'acp_token.json') };
}

const removedEnvironmentKeys = new Set([
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_QUOTA_PROJECT',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GCLOUD_PROJECT',
  'CLOUDSDK_CORE_PROJECT',
  'AGY_ACP_CCPA_PROJECT',
  'AGY_ACP_ENABLE_OAUTH',
  'GEMINI_HOME',
  'AGY_ACP_FORCE_FILE_STORAGE',
  'ANTIGRAVITY_HARNESS_PATH',
  'BROWSER',
  'PYTHONUNBUFFERED',
  'ELECTRON_RUN_AS_NODE'
]);

/**
 * Python splits BROWSER on the platform path separator before parsing quotes.
 * Keep the helper source free of both colons and semicolons. EPIPE must still
 * exit 0 so Python does not fall back to an OS browser after cancellation.
 */
export const antigravityBrowserHelperSource =
  `process.stderr.on("error",()=>process.exit(0)).write(` +
  `"${ANTIGRAVITY_AUTH_BROWSER_MARKER}"+JSON.stringify(process.argv[1])+"\\n",` +
  `()=>process.exit(0))`;

export const ANTIGRAVITY_BROWSER_PREFLIGHT_URL = 'https://example.invalid/atlas-antigravity-browser-preflight';

function quoteBrowserArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Build the `BROWSER` value that routes URL opens through our marker helper. */
export function buildAntigravityBrowserCommand(runtimeExecutablePath: string): string {
  const args = [runtimeExecutablePath, '-e', antigravityBrowserHelperSource, '--', '%s'];
  return args.map(quoteBrowserArgument).join(' ');
}

/** Reject runtime paths that cannot be used for browser suppression. */
export function validateAntigravityBrowserCommand(
  browserCommand: string,
  runtimeExecutablePath: string,
  platform: NodeJS.Platform
): string | null {
  if (
    browserCommand.includes(platform === 'win32' ? ';' : ':') ||
    runtimeExecutablePath.includes('\r') ||
    runtimeExecutablePath.includes('\n') ||
    runtimeExecutablePath.includes('\0') ||
    runtimeExecutablePath.includes('%s')
  ) {
    return 'The Atlas runtime path cannot be used to suppress Antigravity browser launches.';
  }
  return null;
}

export function antigravityEnvironment(
  profile: Pick<AntigravityProfile, 'geminiHome' | 'browserCommand'>,
  baseEnv: NodeJS.ProcessEnv,
  auth: AntigravityAuthConfig
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!removedEnvironmentKeys.has(key.toUpperCase())) environment[key] = value;
  }
  const credential =
    auth.authMethod === 'gemini-api-key' && auth.apiKey
      ? { GEMINI_API_KEY: auth.apiKey }
      : auth.authMethod === 'agent-platform' && auth.apiKey
        ? { GOOGLE_API_KEY: auth.apiKey }
        : {};
  return {
    ...environment,
    ...credential,
    GEMINI_HOME: profile.geminiHome,
    AGY_ACP_FORCE_FILE_STORAGE: '1',
    BROWSER: profile.browserCommand,
    PYTHONUNBUFFERED: '1',
    ELECTRON_RUN_AS_NODE: '1'
  };
}

export interface AntigravitySpawnInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

/** Same subscription-only launch settings T3 applies to every ACP process. */
export function buildAntigravityAcpSpawnInput(input: {
  readonly executablePath: string;
  readonly harnessPath: string;
  readonly profile: AntigravityProfile;
  readonly cwd: string;
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly auth?: AntigravityAuthConfig;
}): AntigravitySpawnInput {
  const auth = input.auth ?? ANTIGRAVITY_PERSONAL_AUTH;
  return {
    command: input.executablePath,
    args: input.profile.platform === 'linux' ? ['--uid='] : [],
    cwd: input.cwd,
    env: {
      ...antigravityEnvironment(input.profile, input.baseEnv ?? process.env, auth),
      ANTIGRAVITY_HARNESS_PATH: input.harnessPath
    }
  };
}

export interface AntigravityAuthorizationUrl {
  readonly authorizationUrl: string;
  readonly redirectUri: string;
  readonly state: string;
}

const MAX_AUTHORIZATION_URL_LENGTH = 16_384;

/** Reads only the public authorization request, never an OAuth token file. */
export function parseAntigravityAuthorizationUrl(
  authorizationUrl: string
): AntigravityAuthorizationUrl {
  const invalid = (): never => {
    throw new Error('Antigravity returned an invalid Google sign-in URL.');
  };
  if (authorizationUrl.length > MAX_AUTHORIZATION_URL_LENGTH || /\s/.test(authorizationUrl)) {
    invalid();
  }
  let url: URL;
  try {
    url = new URL(authorizationUrl);
  } catch {
    invalid();
  }
  const state = url!.searchParams.get('state');
  const redirectUri = url!.searchParams.get('redirect_uri');
  if (
    url!.origin !== 'https://accounts.google.com' ||
    url!.pathname !== '/o/oauth2/v2/auth' ||
    url!.username !== '' ||
    url!.password !== '' ||
    url!.hash !== '' ||
    url!.searchParams.getAll('state').length !== 1 ||
    url!.searchParams.getAll('redirect_uri').length !== 1 ||
    url!.searchParams.getAll('response_type').length !== 1 ||
    url!.searchParams.get('response_type') !== 'code' ||
    state === null ||
    state.length === 0 ||
    state.length > 512 ||
    /\s/.test(state) ||
    redirectUri === null ||
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/$/.test(redirectUri)
  ) {
    invalid();
  }
  let redirect: URL;
  try {
    redirect = new URL(redirectUri!);
  } catch {
    invalid();
  }
  if (Number(redirect!.port) < 1024) invalid();
  return { authorizationUrl, redirectUri: redirectUri!, state: state! };
}

/** True for native auth failures and interactive login blocked by Atlas. */
export function isAntigravitySignInRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message === ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE) return true;
  // ACP JSON-RPC -32000 from the agent means "not signed in" in practice.
  return /-32000|sign.?in|not authenticated|unauthorized/i.test(message);
}
