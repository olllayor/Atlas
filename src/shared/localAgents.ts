import type { z } from 'zod';

import type { LocalAgentSettingsSchema } from './localAgentsSchema';
import { OPENCODE_PROVIDER_ID } from './opencodeSettings';

/**
 * Local coding agents Atlas can drive as providers: CLIs that already live on
 * the machine, sign themselves in, and run their own tools during a turn.
 *
 * They are not endpoints — there is no base URL and no API key to paste — so
 * they get their own catalog, their own settings blob and their own section in
 * Settings, separate from the custom (BYOK) providers.
 *
 * Transport is the honest dividing line:
 *
 * - `'acp'`  — the agent speaks the Agent Client Protocol over stdio, so Atlas
 *   can list its models and run turns through the shared `AcpClient`.
 * - `'sdk'`  — driven over their official SDKs directly, the way t3code does:
 *   opencode (via @opencode-ai/sdk) and claude-code (via @anthropic-ai/claude-agent-sdk).
 * - `'none'` — the agent is detected (installed? which version?) and
 *   configurable, but has no wire Atlas can drive yet. Enabling is refused
 *   with `unsupportedReason` rather than a switch that does nothing.
 */

export const LOCAL_AGENT_IDS = [
  OPENCODE_PROVIDER_ID,
  'claude-code',
  'codex',
  'cursor',
  'grok',
  'antigravity'
] as const;

export type LocalAgentId = (typeof LOCAL_AGENT_IDS)[number];

export function isLocalAgentId(value: unknown): value is LocalAgentId {
  return typeof value === 'string' && (LOCAL_AGENT_IDS as readonly string[]).includes(value);
}

export type LocalAgentTransport = 'acp' | 'sdk' | 'none';

/** Accent colors offered per agent. `''` keeps the neutral default. */
export const LOCAL_AGENT_COLORS = ['blue', 'green', 'orange', 'red', 'purple', 'teal'] as const;
export type LocalAgentColor = (typeof LOCAL_AGENT_COLORS)[number];

export interface LocalAgentDefinition {
  readonly id: LocalAgentId;
  readonly label: string;
  /** models.dev logo id the renderer bundles; falls back to a monogram. */
  readonly logoId: string;
  /** Default executable, resolved from PATH unless `binaryPath` overrides it. */
  readonly binary: string;
  readonly versionArgs: readonly string[];
  readonly transport: LocalAgentTransport;
  /**
   * How to start an ACP session. `'self'` means the agent binary itself
   * speaks ACP; anything else is a separate bridge command the user can
   * override (`acpCommand`), because it ships as its own package.
   */
  readonly acp?: {
    readonly command: 'self' | string;
    readonly args: readonly string[];
    /** Shown when the bridge is missing, e.g. the npm package to install. */
    readonly installHint?: string;
  };
  /** How this agent signs in; it owns its own credentials, Atlas never does. */
  readonly authHint: string;
  /** Why `transport: 'none'` — surfaced verbatim in the UI. */
  readonly unsupportedReason?: string;
  /**
   * `'opencode'` keeps its own settings blob (server mode, password) and is
   * bridged into this list rather than migrated. Everything else lives in the
   * shared `providers.localAgents` record.
   */
  readonly settingsSource: 'localAgents' | 'opencode';
}

export const LOCAL_AGENTS: readonly LocalAgentDefinition[] = [
  {
    id: OPENCODE_PROVIDER_ID,
    label: 'OpenCode',
    logoId: 'opencode',
    binary: 'opencode',
    versionArgs: ['--version'],
    transport: 'sdk',
    authHint: 'opencode auth login',
    settingsSource: 'opencode'
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    logoId: 'anthropic',
    binary: 'claude',
    versionArgs: ['--version'],
    transport: 'sdk',
    authHint: 'claude login',
    settingsSource: 'localAgents'
  },
  {
    id: 'codex',
    label: 'Codex',
    logoId: 'openai',
    binary: 'codex',
    versionArgs: ['--version'],
    transport: 'none',
    authHint: 'codex login',
    unsupportedReason:
      'Codex drives its own app-server protocol rather than ACP, so Atlas can detect and configure it but cannot run turns through it yet.',
    settingsSource: 'localAgents'
  },
  {
    id: 'cursor',
    label: 'Cursor',
    logoId: 'cursor',
    binary: 'cursor-agent',
    versionArgs: ['--version'],
    transport: 'none',
    authHint: 'cursor-agent login',
    unsupportedReason:
      'cursor-agent exposes no ACP endpoint, so Atlas can detect and configure it but cannot run turns through it yet.',
    settingsSource: 'localAgents'
  },
  {
    id: 'grok',
    label: 'Grok',
    logoId: 'xai',
    binary: 'grok',
    versionArgs: ['--version'],
    transport: 'none',
    authHint: 'grok auth',
    unsupportedReason:
      'The Grok CLI exposes no ACP endpoint, so Atlas can detect and configure it but cannot run turns through it yet.',
    settingsSource: 'localAgents'
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    logoId: 'antigravity',
    binary: 'agy_acp_server.par',
    versionArgs: ['--version'],
    transport: 'acp',
    acp: {
      command: 'self',
      args: []
    },
    authHint: 'Sign in with Google in Settings → Antigravity',
    settingsSource: 'localAgents'
  }
];

export function findLocalAgent(id: string): LocalAgentDefinition | null {
  return LOCAL_AGENTS.find((agent) => agent.id === id) ?? null;
}

export type LocalAgentSettings = z.output<typeof LocalAgentSettingsSchema>;

/** Every agent's settings, keyed by id. Missing keys read back as defaults. */
export type LocalAgentSettingsRecord = Partial<Record<LocalAgentId, LocalAgentSettings>>;

export type ParseLocalAgentSettingsResult =
  | { ok: true; settings: LocalAgentSettings }
  | { ok: false; error: string };

/** What `<binary> --version` answered, cached per list call. */
export interface LocalAgentDetection {
  readonly installed: boolean;
  readonly version: string | null;
  /** Absolute path the command resolved to, when it could be resolved. */
  readonly resolvedPath: string | null;
  readonly checkedAt: string;
}

export type LocalAgentProbeStatus = 'ready' | 'warning' | 'error';

/** "Test connection" for an agent: same shape the OpenCode card already used. */
export interface LocalAgentProbeResult {
  readonly agentId: LocalAgentId;
  readonly installed: boolean;
  readonly version: string | null;
  readonly status: LocalAgentProbeStatus;
  readonly modelCount: number;
  readonly message?: string;
}

/**
 * Full view of one local agent as returned to the renderer: definition,
 * persisted settings and live detection, in one record.
 */
export interface LocalAgentStatusView {
  readonly id: LocalAgentId;
  readonly label: string;
  readonly logoId: string;
  readonly transport: LocalAgentTransport;
  readonly unsupportedReason: string | null;
  readonly authHint: string;
  readonly acpInstallHint: string | null;
  readonly enabled: boolean;
  readonly displayName: string;
  readonly color: string;
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly binaryDefault: string;
  readonly acpCommand: string;
  readonly acpCommandDefault: string | null;
  readonly launchArgs: string;
  readonly env: Record<string, string>;
  readonly customModels: readonly string[];
  /** Antigravity sign-in method (other agents ignore it). */
  readonly antigravityAuthMethod: 'oauth-personal' | 'oauth-business' | 'gemini-api-key' | 'agent-platform';
  readonly antigravityGcpProject: string;
  readonly antigravityGcpLocation: string;
  readonly detection: LocalAgentDetection;
  /** Present only for `opencode`, whose integration predates this list. */
  readonly opencode?: {
    /** Blank spawns a scoped `opencode serve`; a URL talks to your own server. */
    readonly serverUrl: string;
    readonly hasServerPassword: boolean;
  };
}

/** What the renderer may send back; every field optional, all validated. */
export interface LocalAgentUpdateRequest {
  readonly agentId: LocalAgentId;
  readonly enabled?: boolean;
  readonly displayName?: string;
  readonly color?: string;
  readonly binaryPath?: string;
  readonly homePath?: string;
  readonly acpCommand?: string;
  readonly launchArgs?: string;
  readonly env?: Record<string, string>;
  readonly customModels?: string[];
  /** Antigravity-only; ignored for every other agent. */
  readonly antigravityAuthMethod?: 'oauth-personal' | 'oauth-business' | 'gemini-api-key' | 'agent-platform';
  readonly antigravityGcpProject?: string;
  readonly antigravityGcpLocation?: string;
  /** opencode-only; ignored for every other agent. */
  readonly serverUrl?: string;
}
