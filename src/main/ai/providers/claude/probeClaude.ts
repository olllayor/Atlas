import { query } from '@anthropic-ai/claude-agent-sdk';

import { makeClaudeEnvironment } from './claudeHome.js';
import { resolveClaudeSdkExecutablePath } from './claudeExecutable.js';
import { detectLocalAgent } from '../../agents/localAgentDetection.js';

export const CLAUDE_UNAUTHENTICATED_MESSAGE =
  "Claude Code is not authenticated. Run `claude auth login` in a terminal (using this instance's Claude configuration) and try again.";

export interface ClaudeAccountInfo {
  readonly email?: string;
  readonly organization?: string;
  readonly subscriptionType?: string;
  readonly tokenSource?: string;
  readonly apiKeySource?: string;
  readonly apiProvider?: string;
}

export interface ClaudeModelOption {
  readonly id: string;
  readonly label: string;
  readonly resolvedModel?: string;
  /** False when the model takes no effort level; absent when unknown. */
  readonly supportsEffort?: boolean;
  readonly supportedEffortLevels?: ReadonlyArray<'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
}

export interface ClaudeProbeResult {
  readonly installed: boolean;
  readonly version: string | null;
  readonly status: 'ready' | 'warning' | 'error';
  readonly models: ClaudeModelOption[];
  readonly account?: ClaudeAccountInfo;
  readonly message?: string;
}

export const DEFAULT_CLAUDE_MODELS: readonly ClaudeModelOption[] = [
  { id: 'default', label: 'Default (recommended)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'haiku', label: 'Haiku' }
];

const CAPABILITIES_PROBE_TIMEOUT_MS = 6_000;
/** t3code parity: capabilities are per binary + home + cwd, refreshed lazily. */
const CAPABILITIES_CACHE_TTL_MS = 5 * 60_000;

interface CachedProbe {
  readonly at: number;
  readonly result: ClaudeProbeResult;
}

const probeCache = new Map<string, CachedProbe>();

function probeCacheKey(options: {
  binaryPath: string;
  homePath?: string;
  cwd?: string;
}): string {
  return `${options.binaryPath.trim() || 'claude'}\0${options.homePath?.trim() ?? ''}\0${options.cwd ?? ''}`;
}

export function clearClaudeProbeCache(): void {
  probeCache.clear();
}

export async function probeClaude(options: {
  binaryPath: string;
  homePath?: string;
  launchArgs?: string;
  env?: Record<string, string>;
  customModels?: readonly string[];
  cwd?: string;
  detectionDeps?: import('../../agents/localAgentDetection.js').LocalAgentDetectionDeps;
}): Promise<ClaudeProbeResult> {
  const binaryCommand = options.binaryPath.trim() || 'claude';
  const cached = probeCache.get(probeCacheKey(options));
  if (cached && Date.now() - cached.at < CAPABILITIES_CACHE_TTL_MS) {
    return appendCustomModels(cached.result, options.customModels);
  }
  const detection = await detectLocalAgent(
    {
      command: binaryCommand,
      versionArgs: ['--version'],
      env: options.env
    },
    options.detectionDeps
  );

  if (!detection.installed) {
    return {
      installed: false,
      version: null,
      status: 'error',
      models: [],
      message: `Claude Agent CLI (${binaryCommand}) was not found on PATH.`
    };
  }

  const executablePath = resolveClaudeSdkExecutablePath(
    detection.resolvedPath ?? binaryCommand,
    options.env
  );
  const environment = makeClaudeEnvironment(options);

  // Probe capabilities by spawning a lightweight Claude Agent SDK session.
  // We pass a never-yielding AsyncIterable so that no user message is ever sent,
  // preventing any prompt from reaching the Anthropic API (blueprint: t3code ClaudeProvider.ts).
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CAPABILITIES_PROBE_TIMEOUT_MS);

  try {
    const q = query({
      prompt: (async function* () {
        await new Promise((resolve) => abort.signal.addEventListener('abort', resolve));
      })(),
      options: {
        pathToClaudeCodeExecutable: executablePath,
        abortController: abort,
        allowedTools: [],
        persistSession: false,
        env: environment,
        cwd: options.cwd
      }
    });

    const init = await q.initializationResult();
    q.close();
    abort.abort();
    clearTimeout(timer);

    const account = init.account as ClaudeAccountInfo | undefined;
    const discoveredModels: ClaudeModelOption[] = (init.models ?? []).map((m) => ({
      id: m.value,
      label: m.displayName || m.value,
      resolvedModel: m.resolvedModel,
      ...(typeof m.supportsEffort === 'boolean' ? { supportsEffort: m.supportsEffort } : {}),
      ...(Array.isArray(m.supportedEffortLevels) && m.supportedEffortLevels.length > 0
        ? { supportedEffortLevels: [...m.supportedEffortLevels] }
        : {})
    }));

    // A logged-out first-party CLI still initializes and reports tokenSource "none"
    // with no apiKeySource (t3code PR #8869). Only that explicit combination counts as logged out.
    const isUnauthenticated =
      account?.apiProvider === 'firstParty' &&
      account?.tokenSource === 'none' &&
      !account?.apiKeySource;

    if (isUnauthenticated) {
      const result: ClaudeProbeResult = {
        installed: true,
        version: detection.version,
        status: 'error',
        models: discoveredModels.length > 0 ? discoveredModels : [...DEFAULT_CLAUDE_MODELS],
        account,
        message: CLAUDE_UNAUTHENTICATED_MESSAGE
      };
      probeCache.set(probeCacheKey(options), { at: Date.now(), result });
      return appendCustomModels(result, options.customModels);
    }

    const result: ClaudeProbeResult = {
      installed: true,
      version: detection.version,
      status: 'ready',
      models: discoveredModels.length > 0 ? discoveredModels : [...DEFAULT_CLAUDE_MODELS],
      account,
      message: ''
    };
    const accountLabel = [account?.subscriptionType, account?.email].filter(Boolean).join(' · ');
    const completed: ClaudeProbeResult = {
      ...result,
      message: accountLabel ? `Connected · ${accountLabel}` : 'Connected to Claude Code.'
    };
    probeCache.set(probeCacheKey(options), { at: Date.now(), result: completed });
    return appendCustomModels(completed, options.customModels);
  } catch (_err) {
    clearTimeout(timer);
    return appendCustomModels(
      {
        installed: true,
        version: detection.version,
        status: 'ready',
        models: [...DEFAULT_CLAUDE_MODELS],
        message: `Connected to Claude Code v${detection.version ?? 'unknown'}.`
      },
      options.customModels
    );
  }
}

/** Custom ids merge after the cached catalog so a settings edit needs no re-probe. */
function appendCustomModels(
  result: ClaudeProbeResult,
  customModels: readonly string[] | undefined
): ClaudeProbeResult {
  if (!customModels || customModels.length === 0) {
    return result;
  }
  const models = [...result.models];
  const knownIds = new Set(models.map((m) => m.id));
  for (const custom of customModels) {
    const id = custom.trim();
    if (id && !knownIds.has(id)) {
      knownIds.add(id);
      models.push({ id, label: id });
    }
  }
  return { ...result, models };
}
