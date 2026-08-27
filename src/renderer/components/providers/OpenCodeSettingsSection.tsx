import { useCallback, useEffect, useState } from 'react';

import type {
  OpenCodeIntegrationMode,
  OpenCodeProbeResult,
  OpenCodeStatusView
} from '../../../shared/contracts';
import { notify } from '../../lib/notify';
import { Switch as UiSwitch } from '../ui/switch';

/**
 * Settings card for the deep OpenCode integration (plan T8).
 *
 * Shaped after t3code's provider card (`apps/web/.../ProviderInstanceCard.tsx`):
 * the header is the status line — dot, name, version, enable switch — and the
 * form sits under it, visible only once the integration is on. Everything the
 * card renders comes from one probe result, so the states below are exactly
 * the states the main process can report.
 */

type Tone = 'ready' | 'warning' | 'error' | 'idle';

const DOT_CLASS: Record<Tone, string> = {
  ready: 'bg-success',
  warning: 'bg-warning-text',
  error: 'bg-error',
  idle: 'bg-text-faint'
};

const MODES: Array<{ id: OpenCodeIntegrationMode; label: string; hint: string }> = [
  { id: 'server', label: 'SDK server', hint: 'Atlas runs opencode serve and drives it over the SDK.' },
  { id: 'acp', label: 'ACP', hint: 'Launches OpenCode over stdio. Not implemented yet.' }
];

/** Did this write move any field the probe's answer depended on? */
function changesConfiguration(
  patch: Partial<OpenCodeStatusView>,
  before: OpenCodeStatusView | null,
  after: OpenCodeStatusView
): boolean {
  if (!before) return true;
  return (Object.keys(patch) as Array<keyof OpenCodeStatusView>).some(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
  );
}

function summarize(probe: OpenCodeProbeResult | null, probing: boolean, enabled: boolean) {
  if (!enabled) {
    return { tone: 'idle' as Tone, headline: 'Off', detail: 'Nothing spawns or connects while this is off.' };
  }
  if (probing) {
    return { tone: 'idle' as Tone, headline: 'Checking', detail: 'Asking OpenCode for its version and providers.' };
  }
  if (!probe) {
    return { tone: 'idle' as Tone, headline: 'Not checked', detail: 'Run Test connection to see what OpenCode reports.' };
  }
  if (probe.status === 'ready') {
    const count = probe.connectedProviders.length;
    return {
      tone: 'ready' as Tone,
      headline: 'Connected',
      detail: `${count} upstream ${count === 1 ? 'provider' : 'providers'}, ${probe.modelCount} models.`
    };
  }
  return {
    tone: (probe.status === 'warning' ? 'warning' : 'error') as Tone,
    headline: probe.status === 'warning' ? 'Needs attention' : 'Unavailable',
    detail: probe.message ?? 'OpenCode failed its checks.'
  };
}

const inputClass =
  'h-8 w-64 rounded-md border border-border-default bg-transparent px-2.5 text-xs font-mono text-text-primary outline-none transition focus:border-brand placeholder:text-text-muted';
const buttonClass =
  'h-8 rounded-md bg-bg-hover px-3 text-xs font-medium text-text-primary transition hover:bg-bg-active disabled:opacity-50';

export function OpenCodeSettingsSection() {
  const [status, setStatus] = useState<OpenCodeStatusView | null>(null);
  const [probe, setProbe] = useState<OpenCodeProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [binaryPath, setBinaryPath] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  // Never seeded from settings: the renderer only ever learns that a password
  // exists, so this holds what the user typed since opening the page.
  const [password, setPassword] = useState('');

  const applyStatus = useCallback((next: OpenCodeStatusView) => {
    setStatus(next);
    setBinaryPath(next.binaryPath);
    setServerUrl(next.serverUrl);
  }, []);

  useEffect(() => {
    void window.atlasChat?.settings?.opencode?.get().then(applyStatus).catch(() => undefined);
  }, [applyStatus]);

  const save = async (patch: Parameters<NonNullable<typeof window.atlasChat>['settings']['opencode']['update']>[0]) => {
    const before = status;
    try {
      const next = await window.atlasChat?.settings?.opencode?.update(patch);
      if (next) {
        applyStatus(next);
        // A probe result describes the configuration it ran against. Once any
        // of those fields moves, the dot would be reporting a server we are no
        // longer pointed at, so the card goes back to "not checked". A blur
        // that saved the same value changes nothing and keeps the result.
        if (changesConfiguration(patch, before, next)) {
          setProbe(null);
        }
      }
      return true;
    } catch (error) {
      notify({
        tone: 'error',
        title: 'OpenCode settings not saved',
        description: error instanceof Error ? error.message : String(error)
      });
      // Put the fields back to what is actually stored rather than leaving a
      // rejected value on screen as if it had been saved.
      const current = await window.atlasChat?.settings?.opencode?.get().catch(() => null);
      if (current) applyStatus(current);
      return false;
    }
  };

  const handleToggle = async (enabled: boolean) => {
    const saved = await save({ enabled });
    if (!saved) return;
    notify({
      tone: 'success',
      title: enabled ? 'OpenCode enabled' : 'OpenCode disabled',
      description: enabled
        ? 'Refresh models to pick up its catalog.'
        : 'Its models are gone from the picker and any server was stopped.'
    });
  };

  const handleProbe = async () => {
    setProbing(true);
    try {
      const result = await window.atlasChat?.settings?.opencode?.probe();
      setProbe(result ?? null);
      if (result && result.status !== 'error') {
        notify({
          tone: 'success',
          title: `OpenCode ${result.version ? `v${result.version}` : 'reachable'}`,
          description: result.message ?? 'Connected.'
        });
      } else if (result) {
        notify({ tone: 'error', title: 'OpenCode check failed', description: result.message ?? 'Unknown failure.' });
      }
    } catch (error) {
      notify({
        tone: 'error',
        title: 'OpenCode check failed',
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setProbing(false);
    }
  };

  const handlePassword = async (secret: string | null) => {
    try {
      const next = await window.atlasChat?.settings?.opencode?.setPassword(secret);
      if (next) applyStatus(next);
      setPassword('');
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

  const enabled = status?.enabled ?? false;
  const mode = status?.integrationMode ?? 'server';
  const summary = summarize(probe, probing, enabled);
  const versionLabel = probe?.version ? `v${probe.version}` : null;

  return (
    <div className="rounded-lg border border-border-subtle">
      <div className="flex items-start justify-between gap-6 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${DOT_CLASS[summary.tone]}`} aria-hidden />
            <span className="text-md font-normal text-text-primary">OpenCode</span>
            {versionLabel ? <code className="text-xs text-text-tertiary">{versionLabel}</code> : null}
            <span className="rounded border border-border-subtle px-1.5 py-0.5 text-2xs text-text-tertiary">Beta</span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-text-tertiary">
            <span className="text-text-secondary">{summary.headline}</span>
            {summary.detail ? <span className="text-text-tertiary">{` · ${summary.detail}`}</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {enabled ? (
            <button type="button" className={buttonClass} onClick={handleProbe} disabled={probing}>
              {probing ? 'Testing…' : 'Test connection'}
            </button>
          ) : null}
          <UiSwitch
            checked={enabled}
            onCheckedChange={(next) => void handleToggle(next)}
            aria-label="Enable OpenCode"
            className="data-[state=checked]:bg-brand"
          />
        </div>
      </div>

      {enabled ? (
        <div className="border-t border-border-subtle px-4 py-3">
          <div className="flex items-start justify-between gap-6 py-2">
            <div className="min-w-0">
              <div className="text-md font-normal text-text-primary">Integration mode</div>
              <div className="mt-0.5 text-sm leading-relaxed text-text-tertiary">
                {MODES.find((entry) => entry.id === mode)?.hint}
              </div>
            </div>
            <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-border-default">
              {MODES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => void save({ integrationMode: entry.id })}
                  className={`h-8 px-3 text-xs transition ${
                    mode === entry.id ? 'bg-bg-active text-text-primary' : 'text-text-tertiary hover:text-text-primary'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-start justify-between gap-6 py-2">
            <div className="min-w-0">
              <div className="text-md font-normal text-text-primary">Binary path</div>
              <div className="mt-0.5 text-sm leading-relaxed text-text-tertiary">
                Leave blank to resolve <code>opencode</code> from PATH.
              </div>
            </div>
            <input
              type="text"
              className={inputClass}
              value={binaryPath}
              placeholder="/opt/homebrew/bin/opencode"
              onChange={(event) => setBinaryPath(event.target.value)}
              onBlur={() => void save({ binaryPath })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save({ binaryPath });
              }}
            />
          </div>

          {mode === 'server' ? (
            <>
              <div className="flex items-start justify-between gap-6 py-2">
                <div className="min-w-0">
                  <div className="text-md font-normal text-text-primary">Server URL</div>
                  <div className="mt-0.5 text-sm leading-relaxed text-text-tertiary">
                    Leave blank to let Atlas spawn the server when needed.
                  </div>
                </div>
                <input
                  type="url"
                  className={inputClass}
                  value={serverUrl}
                  placeholder="http://127.0.0.1:4096"
                  onChange={(event) => setServerUrl(event.target.value)}
                  onBlur={() => void save({ serverUrl })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void save({ serverUrl });
                  }}
                />
              </div>

              <div className="flex items-start justify-between gap-6 py-2">
                <div className="min-w-0">
                  <div className="text-md font-normal text-text-primary">Server password</div>
                  <div className="mt-0.5 text-sm leading-relaxed text-text-tertiary">
                    Only for a server you run yourself. Stored in the OS keychain, never shown again.
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    type="password"
                    className={inputClass}
                    value={password}
                    placeholder={status?.hasServerPassword ? 'Replace saved password' : 'Optional password'}
                    onChange={(event) => setPassword(event.target.value)}
                    onBlur={() => {
                      if (password.trim()) void handlePassword(password.trim());
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && password.trim()) void handlePassword(password.trim());
                    }}
                  />
                  {status?.hasServerPassword && !password.trim() ? (
                    <button type="button" className={buttonClass} onClick={() => void handlePassword(null)}>
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <p className="py-2 text-sm leading-relaxed text-text-tertiary">
              ACP mode is not implemented yet. Turns still run over the SDK server until it lands.
            </p>
          )}

          <p className="pt-2 text-xs text-text-tertiary">
            OpenCode signs in on its own: run <code>opencode auth login</code>. It runs its own tools during a turn.
          </p>
        </div>
      ) : null}
    </div>
  );
}
