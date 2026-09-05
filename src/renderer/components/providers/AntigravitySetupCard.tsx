import { useCallback, useEffect, useState } from 'react';

import type { LocalAgentStatusView } from '../../../shared/localAgents';
import { useLocalAgentsStore } from '../../stores/useLocalAgentsStore';
import { notify } from '../../lib/notify';

type AuthMethod = 'oauth-personal' | 'oauth-business' | 'gemini-api-key' | 'agent-platform';

const METHOD_OPTIONS: Array<{ value: AuthMethod; label: string }> = [
  { value: 'oauth-personal', label: 'Google account' },
  { value: 'oauth-business', label: 'Gemini Enterprise' },
  { value: 'gemini-api-key', label: 'Gemini API key' },
  { value: 'agent-platform', label: 'Agent Platform (Vertex AI)' }
];

function methodNeedsGcp(method: AuthMethod): boolean {
  return method === 'oauth-business' || method === 'agent-platform';
}

function methodNeedsKey(method: AuthMethod): boolean {
  return method === 'gemini-api-key' || method === 'agent-platform';
}

/**
 * Antigravity setup card: managed install + Google sign-in, mirroring t3code
 * PR #9348's provider card. Install downloads the official ACP archive from
 * Google with hash verification; sign-in completes the OAuth loopback flow
 * (paste the failed `127.0.0.1` redirect URL when setting up from another
 * device). Non-browser methods verify stored credentials instead.
 */
export function AntigravitySetupCard({ agent }: { agent: LocalAgentStatusView }) {
  const update = useLocalAgentsStore((state) => state.update);
  const reload = useLocalAgentsStore((state) => state.load);

  const [installed, setInstalled] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; downloadedBytes: number; totalBytes: number | null } | null>(null);
  const [authState, setAuthState] = useState<string>('idle');
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [gcpProject, setGcpProject] = useState(agent.antigravityGcpProject);
  const [gcpLocation, setGcpLocation] = useState(agent.antigravityGcpLocation);

  const method = agent.antigravityAuthMethod as AuthMethod;

  const refresh = useCallback(async () => {
    try {
      const status = await window.atlasChat.antigravity.installStatus();
      setInstalled(status.installed);
      setInstalling(status.installing);
    } catch {
      setInstalled(null);
    }
    try {
      const auth = await window.atlasChat.antigravity.authStatus();
      setAuthState(auth.state);
      setAuthUrl(auth.authorizationUrl ?? null);
      setAuthMessage(auth.message ?? null);
    } catch {
      // Auth flow lives only in main; a fresh window starts idle.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribe = window.atlasChat.antigravity.onInstallProgress((payload) => {
      setProgress(payload);
      if (payload.phase === 'done') {
        setInstalling(false);
        void refresh().then(() => reload());
      } else {
        setInstalling(true);
      }
    });
    return unsubscribe;
  }, [refresh, reload]);

  useEffect(() => {
    setGcpProject(agent.antigravityGcpProject);
    setGcpLocation(agent.antigravityGcpLocation);
  }, [agent.antigravityGcpProject, agent.antigravityGcpLocation]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, done?: () => void) => {
      setBusy(true);
      try {
        await fn();
        done?.();
        await refresh();
      } catch (error) {
        notify({
          tone: 'error',
          title: 'Antigravity setup failed',
          description: error instanceof Error ? error.message : String(error)
        });
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const progressLabel =
    progress && progress.totalBytes
      ? `${progress.phase} · ${Math.round((progress.downloadedBytes / progress.totalBytes) * 100)}%`
      : progress
        ? `${progress.phase}…`
        : null;

  return (
    <div className="mt-6 rounded-lg border border-border-subtle bg-bg-base/60 p-4">
      <div className="text-2xs font-medium uppercase tracking-[var(--tracking-label)] text-text-faint">
        Antigravity runtime
      </div>

      <div className="mt-2 flex items-center gap-2">
        {installed === null ? (
          <span className="text-xs text-text-faint">Checking install…</span>
        ) : installed ? (
          <span className="text-xs text-text-primary">Installed · official Google ACP agent</span>
        ) : (
          <span className="text-xs text-text-secondary">Not installed</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!installed && (
            <button
              type="button"
              disabled={installing || busy}
              onClick={() => void run(() => window.atlasChat.antigravity.install())}
              className="h-8 rounded-md bg-bg-hover px-3 text-xs font-medium text-text-primary transition hover:bg-bg-active disabled:opacity-50"
            >
              {installing ? 'Installing…' : 'Install'}
            </button>
          )}
          {installed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => window.atlasChat.antigravity.remove(), () => setInstalled(false))}
              className="h-8 rounded-md bg-bg-hover px-3 text-xs text-error transition hover:bg-bg-active disabled:opacity-50"
            >
              Remove runtime
            </button>
          )}
        </div>
      </div>
      {progressLabel && installing ? (
        <p className="mt-1 text-2xs text-text-faint">{progressLabel}</p>
      ) : null}

      <div className="mt-4">
        <label htmlFor="antigravity-method" className="block text-xs font-medium text-text-primary">
          Sign-in method
        </label>
        <select
          id="antigravity-method"
          className="mt-1.5 w-full rounded-md border border-border-subtle bg-bg-base px-3 py-1.5 text-xs text-text-primary focus:border-border-focus focus:outline-none"
          value={method}
          onChange={(event) =>
            void update({
              agentId: agent.id,
              antigravityAuthMethod: event.target.value as AuthMethod
            })
          }
        >
          {METHOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {methodNeedsGcp(method) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="antigravity-gcp-project" className="block text-xs font-medium text-text-primary">
              GCP project
            </label>
            <input
              id="antigravity-gcp-project"
              className="mt-1.5 w-full rounded-md border border-border-subtle bg-bg-base px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-faint focus:border-border-focus focus:outline-none"
              value={gcpProject}
              placeholder="my-project"
              spellCheck={false}
              onChange={(event) => setGcpProject(event.target.value)}
              onBlur={() => void update({ agentId: agent.id, antigravityGcpProject: gcpProject })}
            />
          </div>
          <div>
            <label htmlFor="antigravity-gcp-location" className="block text-xs font-medium text-text-primary">
              Location
            </label>
            <input
              id="antigravity-gcp-location"
              className="mt-1.5 w-full rounded-md border border-border-subtle bg-bg-base px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-faint focus:border-border-focus focus:outline-none"
              value={gcpLocation}
              placeholder="us-central1"
              spellCheck={false}
              onChange={(event) => setGcpLocation(event.target.value)}
              onBlur={() => void update({ agentId: agent.id, antigravityGcpLocation: gcpLocation })}
            />
          </div>
        </div>
      )}

      {methodNeedsKey(method) && (
        <div className="mt-3">
          <label htmlFor="antigravity-api-key" className="block text-xs font-medium text-text-primary">
            API key
          </label>
          <p className="mt-0.5 text-2xs text-text-faint">Stored in your OS keychain, never in settings.</p>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id="antigravity-api-key"
              type="password"
              className="w-full rounded-md border border-border-subtle bg-bg-base px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-faint focus:border-border-focus focus:outline-none"
              value={apiKey}
              placeholder="Paste key"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <button
              type="button"
              disabled={!apiKey.trim() || busy}
              onClick={() =>
                void run(() => window.atlasChat.antigravity.setApiKey(apiKey.trim()), () => setApiKey(''))
              }
              className="h-8 shrink-0 rounded-md bg-bg-hover px-3 text-xs text-text-primary hover:bg-bg-active disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-border-subtle pt-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary">
            {authState === 'authenticated'
              ? 'Signed in'
              : authState === 'awaiting-callback'
                ? 'Waiting for Google consent…'
                : authState === 'verifying'
                  ? 'Verifying…'
                  : authState === 'error'
                    ? `Sign-in failed${authMessage ? ` · ${authMessage}` : ''}`
                    : 'Not signed in'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {authState === 'authenticated' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => window.atlasChat.antigravity.authLogout())}
                className="h-8 rounded-md bg-bg-hover px-3 text-xs text-text-primary hover:bg-bg-active disabled:opacity-50"
              >
                Sign out
              </button>
            ) : authState === 'awaiting-callback' || authState === 'verifying' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => window.atlasChat.antigravity.authCancel())}
                className="h-8 rounded-md bg-bg-hover px-3 text-xs text-text-primary hover:bg-bg-active disabled:opacity-50"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !installed}
                title={installed ? undefined : 'Install the runtime first'}
                onClick={() =>
                  void run(async () => {
                    const status = await window.atlasChat.antigravity.authStart();
                    setAuthState(status.state);
                    setAuthUrl(status.authorizationUrl ?? null);
                    setAuthMessage(status.message ?? null);
                  })
                }
                className="h-8 rounded-md bg-bg-hover px-3 text-xs font-medium text-text-primary transition hover:bg-bg-active disabled:opacity-50"
              >
                {methodNeedsKey(method) && !methodNeedsGcp(method) ? 'Connect' : method === 'agent-platform' && !apiKey ? 'Connect' : method === 'oauth-personal' || method === 'oauth-business' ? 'Sign in with Google' : 'Connect'}
              </button>
            )}
          </div>
        </div>

        {authUrl && authState === 'awaiting-callback' ? (
          <p className="mt-2 break-all text-2xs text-text-faint">
            If the browser did not open (or you are on another device), open this URL manually:{' '}
            <span className="font-mono text-text-tertiary">{authUrl}</span>
          </p>
        ) : null}

        {authState === 'awaiting-callback' ? (
          <div className="mt-3">
            <label htmlFor="antigravity-callback" className="block text-xs font-medium text-text-primary">
              Paste the redirect URL
            </label>
            <p className="mt-0.5 text-2xs text-text-faint">
              After consent the browser lands on a `127.0.0.1` address that fails to load. Paste that full URL here.
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="antigravity-callback"
                className="w-full rounded-md border border-border-subtle bg-bg-base px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-faint focus:border-border-focus focus:outline-none"
                value={callbackUrl}
                placeholder="http://127.0.0.1:PORT/?code=…&state=…"
                spellCheck={false}
                onChange={(event) => setCallbackUrl(event.target.value)}
              />
              <button
                type="button"
                disabled={!callbackUrl.trim() || busy}
                onClick={() =>
                  void run(() => window.atlasChat.antigravity.authComplete(callbackUrl.trim()), () =>
                    setCallbackUrl('')
                  )
                }
                className="h-8 shrink-0 rounded-md bg-bg-hover px-3 text-xs text-text-primary hover:bg-bg-active disabled:opacity-40"
              >
                Verify
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
