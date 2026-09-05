import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';

import type {
  LocalAgentId,
  LocalAgentProbeResult,
  LocalAgentStatusView,
  LocalAgentUpdateRequest
} from '../../../shared/localAgents';
import { LOCAL_AGENT_COLORS, type LocalAgentColor } from '../../../shared/localAgents';
import { useLocalAgentsStore } from '../../stores/useLocalAgentsStore';
import { notify } from '../../lib/notify';
import { AntigravitySetupCard } from './AntigravitySetupCard';
import { ProviderLogo } from '../../lib/providerLogos';
import { Switch } from '../ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

type Tone = 'idle' | 'ready' | 'warning' | 'error';

// design-tokens-allow: agent status indicator dots
const DOT_CLASS: Record<Tone, string> = {
  idle: 'bg-text-faint',
  ready: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.35)]',
  warning: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.35)]',
  error: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.35)]'
};

// design-tokens-allow: agent accent color swatches
const SWATCH_CLASS: Record<LocalAgentColor, string> = {
  blue: 'bg-blue-500 hover:bg-blue-400',
  green: 'bg-emerald-500 hover:bg-emerald-400',
  orange: 'bg-amber-500 hover:bg-amber-400',
  // design-tokens-allow: agent accent color swatches
  red: 'bg-rose-500 hover:bg-rose-400',
  purple: 'bg-purple-500 hover:bg-purple-400',
  teal: 'bg-teal-500 hover:bg-teal-400'
};

const ACCENT_TEXT_CLASS: Partial<Record<LocalAgentColor, string>> = {
  blue: 'text-agent-blue',
  green: 'text-agent-green',
  orange: 'text-agent-orange',
  red: 'text-agent-red',
  purple: 'text-agent-purple',
  teal: 'text-agent-teal'
};

/**
 * One line that answers "can I use this right now?" — the same question the
 * dot answers in colour. Detection comes first: nothing else matters about an
 * agent that is not on the machine.
 */
function summarize(
  agent: LocalAgentStatusView,
  probe: LocalAgentProbeResult | undefined,
  probing: boolean
): { tone: Tone; headline: string; detail: string } {
  if (!agent.detection.installed) {
    return {
      tone: 'idle',
      headline: 'Not installed',
      detail: `${agent.binaryPath.trim() || agent.binaryDefault} was not found on your PATH.`
    };
  }

  if (agent.transport === 'none') {
    return {
      tone: 'idle',
      headline: 'Detected',
      detail: agent.unsupportedReason ?? 'No chat transport yet.'
    };
  }

  if (!agent.enabled) {
    return { tone: 'idle', headline: 'Disabled', detail: 'Nothing spawns or connects while this is off.' };
  }

  if (probing) {
    return { tone: 'idle', headline: 'Checking', detail: `Asking ${agent.label} what it can do.` };
  }

  if (!probe) {
    return { tone: 'idle', headline: 'Enabled', detail: 'Run Test connection to see what it reports.' };
  }

  if (probe.status === 'ready') {
    const transportLabel =
      agent.transport === 'sdk'
        ? (agent.id === 'claude-code' ? 'its CLI' : 'its server')
        : 'ACP';
    return {
      tone: 'ready',
      headline: 'Connected',
      detail: `${probe.modelCount} ${probe.modelCount === 1 ? 'model' : 'models'} over ${transportLabel}.`
    };
  }

  return {
    tone: probe.status === 'warning' ? 'warning' : 'error',
    headline: probe.status === 'warning' ? 'Needs attention' : 'Unavailable',
    detail: probe.message ?? `${agent.label} failed its checks.`
  };
}

export function LocalAgentsSection() {
  const agents = useLocalAgentsStore((state) => state.agents);
  const selectedAgentId = useLocalAgentsStore((state) => state.selectedAgentId);
  const isLoading = useLocalAgentsStore((state) => state.isLoading);
  const probes = useLocalAgentsStore((state) => state.probes);
  const probingAgentId = useLocalAgentsStore((state) => state.probingAgentId);
  const error = useLocalAgentsStore((state) => state.error);
  const load = useLocalAgentsStore((state) => state.load);
  const select = useLocalAgentsStore((state) => state.select);
  const update = useLocalAgentsStore((state) => state.update);
  const clearError = useLocalAgentsStore((state) => state.clearError);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = agents.find((agent) => agent.id === selectedAgentId) ?? null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xs font-medium uppercase tracking-[var(--tracking-label)] text-text-faint">
          Local agents
        </span>
        <span className="text-xs text-text-faint">
          Coding CLIs that run on your machine.
        </span>
      </div>

      {error ? (
        <div className="mt-3 flex items-center justify-between rounded-md border border-error-border bg-error-bg px-3 py-2 text-xs text-error-text">
          <span>{error}</span>
          <button
            type="button"
            onClick={clearError}
            className="ml-3 text-2xs uppercase tracking-[var(--tracking-label)] text-error-text/70 transition hover:text-error-text"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-[15.5rem_1fr] gap-6">
        <div className="flex flex-col gap-1">
          {agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              selected={agent.id === selectedAgentId}
              probing={probingAgentId === agent.id}
              probe={probes[agent.id]}
              onSelect={() => select(agent.id)}
              onToggle={(enabled) => void update({ agentId: agent.id, enabled })}
            />
          ))}
          {isLoading && agents.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-text-faint">
              Detecting local agents…
            </div>
          ) : null}
        </div>

        <div className="min-w-0 rounded-lg border border-border-subtle bg-bg-surface/40 p-5">
          {selected ? (
            <AgentDetail key={selected.id} agent={selected} />
          ) : (
            <div className="py-12 text-center text-xs text-text-faint">
              Select an agent to view its configuration.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  selected,
  probing,
  probe,
  onSelect,
  onToggle
}: {
  agent: LocalAgentStatusView;
  selected: boolean;
  probing: boolean;
  probe: LocalAgentProbeResult | undefined;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const summary = summarize(agent, probe, probing);
  const name = agent.displayName.trim() || agent.label;
  const canEnable = agent.transport !== 'none' && agent.detection.installed;

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`group flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition ${
        selected ? 'bg-bg-hover text-text-primary' : 'hover:bg-bg-hover/50 text-text-secondary'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[summary.tone]}`} />
        <ProviderLogo
          providerId={agent.logoId}
          label={name}
          className={`h-4 w-4 shrink-0 ${agent.color ? (ACCENT_TEXT_CLASS[agent.color as LocalAgentColor] ?? '') : ''}`}
        />
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-text-primary">{name}</div>
          <div className="truncate text-2xs text-text-faint">{summary.headline}</div>
        </div>
      </div>

      {canEnable ? (
        <div onClick={(event) => event.stopPropagation()}>
          <Switch checked={agent.enabled} onCheckedChange={onToggle} aria-label={`Enable ${name}`} />
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-not-allowed opacity-40">
              <Switch checked={false} disabled aria-label={`${name} unavailable`} />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {agent.transport === 'none'
              ? agent.unsupportedReason ?? 'Not supported yet.'
              : `Install ${agent.binaryDefault} first.`}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

type Tab = 'configuration' | 'models';

function AgentDetail({ agent }: { agent: LocalAgentStatusView }) {
  const update = useLocalAgentsStore((state) => state.update);
  const reload = useLocalAgentsStore((state) => state.load);
  const probe = useLocalAgentsStore((state) => state.probe);
  const probes = useLocalAgentsStore((state) => state.probes);
  const probingAgentId = useLocalAgentsStore((state) => state.probingAgentId);

  const isClaudeCode = agent.id === 'claude-code';
  const [tab, setTab] = useState<Tab>('configuration');
  const [displayName, setDisplayName] = useState(agent.displayName);
  const [binaryPath, setBinaryPath] = useState(agent.binaryPath);
  const [homePath, setHomePath] = useState(agent.homePath ?? '');
  const [acpCommand, setAcpCommand] = useState(agent.acpCommand);
  const [launchArgs, setLaunchArgs] = useState(agent.launchArgs);
  const [serverUrl, setServerUrl] = useState(agent.opencode?.serverUrl ?? '');
  // Never seeded from settings: the renderer only ever learns that a password
  // exists, so this holds what the user typed since opening the page.
  const [password, setPassword] = useState('');
  const [envRows, setEnvRows] = useState<Array<{ key: string; value: string }>>([]);
  const [newModel, setNewModel] = useState('');

  const nameSaved = useSavedFlash();
  const binarySaved = useSavedFlash();
  const homeSaved = useSavedFlash();
  const argsSaved = useSavedFlash();

  // Switching agents must not carry the previous agent's drafts over.
  useEffect(() => {
    setTab('configuration');
    setDisplayName(agent.displayName);
    setBinaryPath(agent.binaryPath);
    setHomePath(agent.homePath ?? '');
    setAcpCommand(agent.acpCommand);
    setLaunchArgs(agent.launchArgs);
    setServerUrl(agent.opencode?.serverUrl ?? '');
    setPassword('');
    setEnvRows(Object.entries(agent.env).map(([key, value]) => ({ key, value })));
    setNewModel('');
  }, [agent.id, agent.displayName, agent.binaryPath, agent.homePath, agent.acpCommand, agent.launchArgs, agent.env, agent.opencode?.serverUrl]);

  const save = useCallback(
    (patch: Omit<LocalAgentUpdateRequest, 'agentId'>) => update({ agentId: agent.id, ...patch }),
    [agent.id, update]
  );

  /** opencode's password lives in the keychain, so it has its own IPC path. */
  const saveServerPassword = async (secret: string | null) => {
    try {
      await window.atlasChat.settings.opencode.setPassword(secret);
      setPassword('');
      await reload();
      notify({
        tone: 'success',
        title: secret ? 'Password saved to keychain' : 'Password cleared',
        description: secret ? 'Sent as HTTP basic auth to your OpenCode server.' : 'Atlas no longer sends one.'
      });
    } catch (error) {
      notify({
        tone: 'error',
        title: 'Password not saved',
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const saveEnv = (rows: Array<{ key: string; value: string }>) => {
    const env: Record<string, string> = {};
    for (const row of rows) {
      const key = row.key.trim();
      if (key) env[key] = row.value;
    }
    void save({ env });
  };

  const summary = summarize(agent, probes[agent.id], probingAgentId === agent.id);
  const name = agent.displayName.trim() || agent.label;
  const isOpenCode = agent.opencode !== undefined;
  const isAntigravity = agent.id === 'antigravity';
  const canProbe = agent.detection.installed;
  const modelCount = agent.customModels.length;
  const advertised = probes[agent.id]?.modelCount ?? null;

  const isDirtyFromDefaults = useMemo(
    () =>
      Boolean(
        agent.displayName ||
          agent.color ||
          agent.binaryPath ||
          agent.homePath ||
          agent.acpCommand ||
          agent.launchArgs ||
          Object.keys(agent.env).length > 0
      ),
    [agent]
  );

  return (
    <div>
      <div className="flex items-center gap-3">
        <ProviderLogo
          providerId={agent.logoId}
          label={name}
          className={`h-6 w-6 ${agent.color ? (ACCENT_TEXT_CLASS[agent.color as LocalAgentColor] ?? '') : ''}`}
        />
        <h3 className="max-w-[16rem] truncate text-md text-text-primary">{name}</h3>
        {agent.detection.version ? (
          <code className="shrink-0 font-mono text-xs text-text-tertiary">v{agent.detection.version}</code>
        ) : null}

        {isDirtyFromDefaults ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() =>
                  void save({
                    displayName: '',
                    color: '',
                    binaryPath: '',
                    homePath: '',
                    acpCommand: '',
                    launchArgs: '',
                    env: {}
                  })
                }
                aria-label={`Reset ${name} to defaults`}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Reset to defaults</TooltipContent>
          </Tooltip>
        ) : null}

        {canProbe ? (
          <button
            type="button"
            onClick={() => void probe(agent.id)}
            disabled={probingAgentId !== null}
            className="ml-auto h-8 shrink-0 whitespace-nowrap rounded-md bg-bg-hover px-3 text-xs font-medium text-text-primary transition hover:bg-bg-active disabled:opacity-50"
          >
            {probingAgentId === agent.id ? 'Testing…' : 'Test connection'}
          </button>
        ) : null}
      </div>

      <p className="mt-2 flex items-start gap-1.5 text-sm leading-relaxed">
        <span aria-hidden className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[summary.tone]}`} />
        <span>
          <span className="text-text-secondary">{summary.headline}</span>
          <span className="text-text-tertiary">{` · ${summary.detail}`}</span>
        </span>
      </p>

      <div className="mt-5 flex gap-5 border-b border-border-subtle">
        <TabButton active={tab === 'configuration'} onClick={() => setTab('configuration')}>
          Configuration
        </TabButton>
        <TabButton active={tab === 'models'} onClick={() => setTab('models')}>
          Models
          <span className="ml-1.5 text-text-faint">
            {advertised === null ? modelCount : `${advertised + modelCount}`}
          </span>
        </TabButton>
      </div>

      {tab === 'configuration' ? (
        <div>
          <Field label="Display name" htmlFor={`agent-name-${agent.id}`} hint={`Blank uses "${agent.label}".`}>
            <div className="flex items-center gap-2">
              <input
                id={`agent-name-${agent.id}`}
                className={fieldInputClass}
                value={displayName}
                placeholder={agent.label}
                onChange={(event) => setDisplayName(event.target.value)}
                onBlur={() => void save({ displayName }).then((ok) => Boolean(ok) && nameSaved.flash())}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              <SavedHint show={nameSaved.saved} />
            </div>
          </Field>

          <div className="mt-4 flex items-center gap-2">
            <span className="text-xs text-text-secondary">Accent:</span>
            {LOCAL_AGENT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => void save({ color })}
                aria-label={`${color} accent`}
                aria-pressed={agent.color === color}
                className={`h-5 w-5 rounded-full transition ${SWATCH_CLASS[color]} ${
                  agent.color === color ? 'ring-2 ring-text-primary ring-offset-2 ring-offset-bg-base' : ''
                }`}
              />
            ))}
          </div>

          <div className="mt-7 text-2xs font-medium uppercase tracking-[var(--tracking-label)] text-text-faint">
            Runtime
          </div>

          <Field
            label="Binary path"
            htmlFor={`agent-binary-${agent.id}`}
            hint={
              agent.detection.resolvedPath
                ? `Resolves to ${agent.detection.resolvedPath}`
                : `Blank resolves ${agent.binaryDefault} from PATH.`
            }
          >
            <div className="flex items-center gap-2">
              <input
                id={`agent-binary-${agent.id}`}
                className={`${fieldInputClass} font-mono text-xs`}
                value={binaryPath}
                placeholder={agent.binaryDefault}
                spellCheck={false}
                onChange={(event) => setBinaryPath(event.target.value)}
                onBlur={() => void save({ binaryPath }).then((ok) => Boolean(ok) && binarySaved.flash())}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              <SavedHint show={binarySaved.saved} />
            </div>
          </Field>

          {isClaudeCode ? (
            <Field
              label="CLAUDE_CONFIG_DIR path"
              htmlFor={`agent-home-${agent.id}`}
              hint="Custom Claude config directory. Keeps .claude.json and .claude separate."
            >
              <div className="flex items-center gap-2">
                <input
                  id={`agent-home-${agent.id}`}
                  className={`${fieldInputClass} font-mono text-xs`}
                  value={homePath}
                  placeholder="~/.claude"
                  spellCheck={false}
                  onChange={(event) => setHomePath(event.target.value)}
                  onBlur={() => void save({ homePath }).then((ok) => Boolean(ok) && homeSaved.flash())}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
                <SavedHint show={homeSaved.saved} />
              </div>
            </Field>
          ) : null}

          {agent.acpCommandDefault ? (
            <Field
              label="ACP bridge command"
              htmlFor={`agent-acp-${agent.id}`}
              hint={
                agent.acpInstallHint
                  ? `${agent.label} speaks ACP through a bridge. Install it with: ${agent.acpInstallHint}`
                  : 'Command that speaks ACP for this agent.'
              }
            >
              <input
                id={`agent-acp-${agent.id}`}
                className={`${fieldInputClass} font-mono text-xs`}
                value={acpCommand}
                placeholder={agent.acpCommandDefault}
                spellCheck={false}
                onChange={(event) => setAcpCommand(event.target.value)}
                onBlur={() => void save({ acpCommand })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </Field>
          ) : null}

          {isOpenCode ? (
            <>
              <Field
                label="Server URL"
                htmlFor={`agent-server-${agent.id}`}
                hint="Blank lets Atlas spawn a scoped opencode serve when needed."
              >
                <input
                  id={`agent-server-${agent.id}`}
                  type="url"
                  className={`${fieldInputClass} font-mono text-xs`}
                  value={serverUrl}
                  placeholder="http://127.0.0.1:4096"
                  onChange={(event) => setServerUrl(event.target.value)}
                  onBlur={() => void save({ serverUrl })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </Field>

              <Field
                label="Server password"
                htmlFor={`agent-password-${agent.id}`}
                hint="Optional. Stored in your OS keychain, sent as HTTP basic auth."
              >
                <div className="flex items-center gap-2">
                  <input
                    id={`agent-password-${agent.id}`}
                    type="password"
                    className={`${fieldInputClass} font-mono text-xs`}
                    value={password}
                    placeholder={agent.opencode?.hasServerPassword ? '••••••••' : 'No password set'}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        if (password) void saveServerPassword(password);
                      }
                    }}
                  />
                  {password ? (
                    <button
                      type="button"
                      onClick={() => void saveServerPassword(password)}
                      className="h-8 shrink-0 rounded-md bg-bg-hover px-2.5 text-xs text-text-primary hover:bg-bg-active"
                    >
                      Save
                    </button>
                  ) : null}
                  {agent.opencode?.hasServerPassword ? (
                    <button
                      type="button"
                      onClick={() => void saveServerPassword(null)}
                      className="h-8 shrink-0 rounded-md bg-bg-hover px-2.5 text-xs text-error hover:bg-bg-active"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </Field>
            </>
          ) : null}

          <Field
            label="Launch arguments"
            htmlFor={`agent-args-${agent.id}`}
            hint="Extra flags appended when starting this agent."
          >
            <div className="flex items-center gap-2">
              <input
                id={`agent-args-${agent.id}`}
                className={`${fieldInputClass} font-mono text-xs`}
                value={launchArgs}
                placeholder={agent.transport === 'sdk' ? 'e.g. --model anthropic/claude-3-5-sonnet' : 'e.g. -v'}
                spellCheck={false}
                onChange={(event) => setLaunchArgs(event.target.value)}
                onBlur={() => void save({ launchArgs }).then((ok) => Boolean(ok) && argsSaved.flash())}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              <SavedHint show={argsSaved.saved} />
            </div>
          </Field>

          <div className="mt-6">
            <div className="flex items-baseline justify-between">
              <label className="block text-xs font-medium text-text-primary">Environment variables</label>
              <span className="text-2xs text-text-faint">Injected into the agent's process.</span>
            </div>            <div className="mt-2 space-y-2">
              {envRows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    className={`${fieldInputClass} font-mono text-xs`}
                    placeholder="NAME"
                    value={row.key}
                    spellCheck={false}
                    onChange={(event) => {
                      const next = [...envRows];
                      next[index] = { key: event.target.value, value: row.value };
                      setEnvRows(next);
                    }}
                    onBlur={() => saveEnv(envRows)}
                  />
                  <input
                    className={`${fieldInputClass} font-mono text-xs`}
                    placeholder="value"
                    value={row.value}
                    spellCheck={false}
                    onChange={(event) => {
                      const next = [...envRows];
                      next[index] = { key: row.key, value: event.target.value };
                      setEnvRows(next);
                    }}
                    onBlur={() => saveEnv(envRows)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = envRows.filter((_, i) => i !== index);
                      setEnvRows(next);
                      saveEnv(next);
                    }}
                    aria-label="Remove variable"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-faint transition hover:bg-bg-hover hover:text-text-primary"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setEnvRows([...envRows, { key: '', value: '' }])}
                className="text-xs text-text-tertiary transition hover:text-text-primary"
              >
                + Add variable
              </button>
            </div>
          </div>

          {isAntigravity ? <AntigravitySetupCard agent={agent} /> : null}
        </div>
      ) : (
        <div>
          <p className="text-xs text-text-secondary">
            {advertised === null
              ? 'Test the connection to discover the models this agent advertises.'
              : `${agent.label} advertises ${advertised} ${advertised === 1 ? 'model' : 'models'}.`}
          </p>

          <div className="mt-4">
            <div className="text-2xs font-medium uppercase tracking-[var(--tracking-label)] text-text-faint">
              Custom model ids
            </div>
            <p className="mt-1 text-xs text-text-tertiary">
              Extra model ids Atlas should offer for this agent, in addition to whatever it advertises.
            </p>

            <div className="mt-3 flex items-center gap-2">
              <input
                className={`${fieldInputClass} font-mono text-xs`}
                placeholder="e.g. deepseek/deepseek-r1"
                value={newModel}
                onChange={(event) => setNewModel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const trimmed = newModel.trim();
                    if (trimmed && !agent.customModels.includes(trimmed)) {
                      void save({ customModels: [...agent.customModels, trimmed] });
                      setNewModel('');
                    }
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const trimmed = newModel.trim();
                  if (trimmed && !agent.customModels.includes(trimmed)) {
                    void save({ customModels: [...agent.customModels, trimmed] });
                    setNewModel('');
                  }
                }}
                disabled={!newModel.trim()}
                className="h-8 shrink-0 rounded-md bg-bg-hover px-3 text-xs font-medium text-text-primary transition hover:bg-bg-active disabled:opacity-40"
              >
                Add
              </button>
            </div>

            {agent.customModels.length > 0 ? (
              <ul className="mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle bg-bg-base/60">
                {agent.customModels.map((model) => (
                  <li key={model} className="flex items-center justify-between px-3 py-2 text-xs font-mono">
                    <span className="text-text-primary">{model}</span>
                    <button
                      type="button"
                      onClick={() =>
                        void save({
                          customModels: agent.customModels.filter((id) => id !== model)
                        })
                      }
                      aria-label={`Remove model ${model}`}
                      className="text-text-faint transition hover:text-text-primary"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-text-primary">
        {label}
      </label>
      {hint ? <p className="mt-0.5 text-2xs text-text-faint">{hint}</p> : null}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pb-2 text-xs font-medium transition ${
        active
          ? 'border-b-2 border-text-primary text-text-primary'
          : 'text-text-tertiary hover:text-text-secondary'
      }`}
    >
      {children}
    </button>
  );
}

function SavedHint({ show }: { show: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-flex items-center gap-1 text-2xs text-success transition-opacity duration-300 ${
        show ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      <Check className="h-3 w-3" />
      Saved
    </span>
  );
}

const fieldInputClass =
  'w-full rounded-md border border-border-subtle bg-bg-base px-3 py-1.5 text-xs text-text-primary placeholder:text-text-faint focus:border-border-focus focus:outline-none';

function useSavedFlash() {
  const [saved, setSaved] = useState(false);
  const flash = useCallback(() => {
    setSaved(true);
    const timer = setTimeout(() => setSaved(false), 1400);
    return () => clearTimeout(timer);
  }, []);
  return { saved, flash };
}
