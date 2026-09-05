import { query } from '@anthropic-ai/claude-agent-sdk';

import { makeClaudeEnvironment } from './claudeHome.js';
import { resolveClaudeSdkExecutablePath } from './claudeExecutable.js';
import { detectLocalAgent } from '../../agents/localAgentDetection.js';

export interface ClaudeAccountInfo {
  readonly email?: string;
  readonly organization?: string;
  readonly subscriptionType?: string;
  readonly tokenSource?: string;
  readonly apiProvider?: string;
}

export interface ClaudeModelOption {
  readonly id: string;
  readonly label: string;
  readonly resolvedModel?: string;
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
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'haiku', label: 'Haiku' }
];

const CAPABILITIES_PROBE_TIMEOUT_MS = 6_000;

export async function probeClaude(options: {
  binaryPath: string;
  homePath?: string;
  launchArgs?: string;
  env?: Record<string, string>;
  customModels?: readonly string[];
  cwd?: string;
}): Promise<ClaudeProbeResult> {
  const binaryCommand = options.binaryPath.trim() || 'claude';
  const detection = await detectLocalAgent({
    command: binaryCommand,
    versionArgs: ['--version'],
    env: options.env
  });

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
      resolvedModel: m.resolvedModel
    }));

    const models = discoveredModels.length > 0 ? discoveredModels : [...DEFAULT_CLAUDE_MODELS];

    const knownIds = new Set(models.map((m) => m.id));
    for (const custom of options.customModels ?? []) {
      const id = custom.trim();
      if (id && !knownIds.has(id)) {
        knownIds.add(id);
        models.push({ id, label: id });
      }
    }

    const accountLabel = [account?.subscriptionType, account?.email].filter(Boolean).join(' · ');
    const message = accountLabel ? `Connected · ${accountLabel}` : 'Connected to Claude Code.';

    return {
      installed: true,
      version: detection.version,
      status: 'ready',
      models,
      account,
      message
    };
  } catch (_err) {
    clearTimeout(timer);
    const models = [...DEFAULT_CLAUDE_MODELS];
    const knownIds = new Set(models.map((m) => m.id));
    for (const custom of options.customModels ?? []) {
      const id = custom.trim();
      if (id && !knownIds.has(id)) {
        knownIds.add(id);
        models.push({ id, label: id });
      }
    }

    return {
      installed: true,
      version: detection.version,
      status: 'ready',
      models,
      message: `Connected to Claude Code v${detection.version ?? 'unknown'}.`
    };
  }
}
