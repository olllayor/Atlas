import { CheckCircledIcon, Cross2Icon, ExclamationTriangleIcon, Link2Icon, ReloadIcon, TrashIcon, UpdateIcon } from '@radix-ui/react-icons';
import { useState } from 'react';

import type { AuthConfig, PluginServerSummary, PluginSummary, PluginUpdateView } from '../../../shared/contracts';
import { notify, notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { Switch as UiSwitch } from '../ui/switch';
import { ConnectorList } from './ConnectorList';
import { PluginIcon } from './PluginIcon';

/**
 * One plugin, and what it is allowed to do.
 */
export function PluginDetailPanel({
  plugin,
  update,
  busy,
  onClose,
  onToggle,
  onUpdate,
  onUninstall
}: {
  plugin: PluginSummary;
  /** What its marketplace offers, once a check has run. */
  update: PluginUpdateView | null;
  busy: boolean;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
  onUpdate: () => void;
  onUninstall: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editingAuth, setEditingAuth] = useState(!plugin.hasCredentials && Boolean(plugin.credentials?.length));
  const [authValues, setAuthValues] = useState<Record<string, string>>({});
  const [savingAuth, setSavingAuth] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [healthStatus, setHealthStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSaveAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAuth(true);
    try {
      await window.atlasChat.plugins.configureAuth(plugin.name, authValues);
      setEditingAuth(false);
      notify({ title: 'Credentials updated', tone: 'success' });
    } catch (err) {
      notifyError('Failed to save credentials', err);
    } finally {
      setSavingAuth(false);
    }
  };

  const handleCheckHealth = async () => {
    setCheckingHealth(true);
    setHealthStatus(null);
    try {
      const res = await window.atlasChat.plugins.checkHealth(plugin.name);
      if (res.ok) {
        setHealthStatus({ ok: true, message: `Connected successfully (${res.toolsCount ?? 0} capabilities ready)` });
      } else {
        setHealthStatus({ ok: false, message: res.error ?? 'Connection check failed.' });
      }
    } catch (err) {
      setHealthStatus({ ok: false, message: String(err) });
    } finally {
      setCheckingHealth(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--overlay)]" onClick={onClose}>
      <aside
        className="scroll-container h-full w-[460px] max-w-full overflow-y-auto bg-bg-base p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <PluginIcon name={plugin.name} iconUrl={plugin.iconUrl} size="lg" />
            <div className="min-w-0">
              <h2 className="truncate text-base font-medium text-text-primary">
                {plugin.displayName ?? plugin.name}
              </h2>
              <p className="text-2xs text-text-faint">
                v{plugin.version}
                {plugin.author ? ` · ${plugin.author}` : ''}
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium',
                    plugin.state === 'enabled'
                      ? 'bg-brand/10 text-brand'
                      : plugin.state === 'needs_configuration'
                      ? 'bg-warning-bg text-warning'
                      : plugin.state === 'error'
                      ? 'bg-error-bg text-error-text'
                      : 'bg-bg-hover text-text-tertiary'
                  )}
                >
                  {plugin.state === 'enabled'
                    ? 'Connected & Enabled'
                    : plugin.state === 'needs_configuration'
                    ? 'Needs Configuration'
                    : plugin.state === 'disabled'
                    ? 'Disabled'
                    : plugin.state}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-text-faint hover:bg-bg-hover"
          >
            <Cross2Icon className="size-4" aria-hidden />
          </button>
        </div>

        <p className="mt-3 text-sm text-text-tertiary">{plugin.description}</p>

        {plugin.blockedReason ? (
          <div className="mt-4 rounded-lg border border-error-border bg-error-bg p-3">
            <p className="text-xs font-medium text-error-text">Withdrawn</p>
            <p className="mt-1 text-2xs text-error-text">{plugin.blockedReason}</p>
            <p className="mt-1.5 text-2xs text-text-tertiary">
              Its skills and tools are not loaded. Removing it is the only thing left to do with it.
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between rounded-lg bg-bg-surface px-3 py-2">
          <span className="text-xs text-text-secondary">Enabled</span>
          <UiSwitch
            checked={plugin.enabled && !plugin.blockedReason}
            onCheckedChange={onToggle}
            disabled={busy || Boolean(plugin.blockedReason)}
          />
        </div>

        {plugin.credentials && plugin.credentials.length > 0 ? (
          <Section title="Account & Authentication" note="Securely stored in your local OS Keychain.">
            {!editingAuth ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary">
                    {plugin.hasCredentials ? 'Credentials configured' : 'Authentication required'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingAuth(true)}
                    className="rounded-md bg-bg-active px-2.5 py-1 text-xs text-text-primary hover:bg-bg-hover"
                  >
                    {plugin.hasCredentials ? 'Update Credentials' : 'Connect Account'}
                  </button>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void handleCheckHealth()}
                    disabled={checkingHealth}
                    className="flex items-center gap-1.5 rounded-md border border-border-default px-2.5 py-1 text-2xs text-text-secondary hover:bg-bg-hover disabled:opacity-50"
                  >
                    <ReloadIcon className={cn('size-3', checkingHealth && 'animate-spin')} />
                    Test Connection
                  </button>
                  {healthStatus ? (
                    <span
                      className={cn(
                        'flex items-center gap-1 text-2xs',
                        healthStatus.ok ? 'text-success' : 'text-error-text'
                      )}
                    >
                      {healthStatus.ok ? (
                        <CheckCircledIcon className="size-3.5" />
                      ) : (
                        <ExclamationTriangleIcon className="size-3.5" />
                      )}
                      {healthStatus.message}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveAuth} className="space-y-3 rounded-lg border border-border-default/60 bg-bg-surface p-3">
                {plugin.credentials.map((cred) => (
                  <label key={'secretName' in cred ? cred.secretName : cred.type} className="block space-y-1">
                    <span className="text-xs font-medium text-text-secondary">
                      {'label' in cred && cred.label ? cred.label : 'secretName' in cred ? cred.secretName : 'API Token'}
                    </span>
                    <input
                      type="password"
                      placeholder={'placeholder' in cred && cred.placeholder ? cred.placeholder : 'Enter value...'}
                      value={'secretName' in cred ? authValues[cred.secretName] ?? '' : ''}
                      onChange={(e) => {
                        if ('secretName' in cred) {
                          setAuthValues({ ...authValues, [cred.secretName]: e.target.value });
                        }
                      }}
                      className="w-full rounded-md border border-border-default bg-bg-base px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-brand"
                    />
                  </label>
                ))}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setEditingAuth(false)}
                    className="rounded-md px-2.5 py-1 text-xs text-text-tertiary hover:text-text-primary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingAuth}
                    className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-text-inverse hover:bg-brand/90 disabled:opacity-50"
                  >
                    {savingAuth ? 'Saving...' : 'Save to Keychain'}
                  </button>
                </div>
              </form>
            )}
          </Section>
        ) : null}

        {update && !plugin.blockedReason ? (
          <UpdateRow update={update} busy={busy} onUpdate={onUpdate} />
        ) : null}

        {plugin.servers.length > 0 ? (
          <Section
            title="MCP Servers & Tools"
            note={
              plugin.skills.length > 0
                ? 'These start when you use one of this plugin’s skills, not before.'
                : 'These start when a tool is used.'
            }
          >
            {plugin.servers.map((server) => (
              <ServerRow key={server.name} server={server} />
            ))}
          </Section>
        ) : null}

        {plugin.connectors.length > 0 ? (
          <Section
            title="Connects to an account"
            note="Atlas reads these declarations; it cannot link an account yet."
          >
            <ConnectorList connectors={plugin.connectors} />
          </Section>
        ) : null}

        {plugin.atlas.workspaceModes.length > 0 ||
        plugin.atlas.requiresProject ||
        plugin.atlas.minAppVersion ? (
          <Section title="Where this applies">
            <ul className="space-y-1 text-2xs text-text-tertiary">
              {plugin.atlas.workspaceModes.length > 0 ? (
                <li>
                  Only in {plugin.atlas.workspaceModes.join(' and ')} mode — elsewhere its skills are
                  not offered, so they cost nothing.
                </li>
              ) : null}
              {plugin.atlas.requiresProject ? <li>Needs a project folder attached.</li> : null}
              {plugin.atlas.minAppVersion ? (
                <li>Needs Atlas {plugin.atlas.minAppVersion} or newer.</li>
              ) : null}
            </ul>
          </Section>
        ) : null}

        {plugin.hooksDeclared ? (
          <Section title="Hooks">
            <p className="text-2xs text-text-tertiary">
              This plugin declares lifecycle hooks. Atlas does not run them — they are arbitrary
              commands fired on session events with nothing in the loop to approve them.
            </p>
          </Section>
        ) : null}

        {plugin.skills.length > 0 ? (
          <Section title={`Skills (${plugin.skills.length})`}>
            <ul className="space-y-2">
              {plugin.skills.map((skill) => (
                <li key={skill.name}>
                  <p className="text-xs text-text-secondary">
                    {skill.name}
                    {skill.implicitInvocation ? null : (
                      <span className="ml-1.5 text-2xs text-text-faint">(only when you ask)</span>
                    )}
                  </p>
                  <p className="text-2xs text-text-tertiary">{skill.description}</p>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {plugin.commands.length > 0 ? (
          <Section
            title={`Commands (${plugin.commands.length})`}
            note="Type / in the composer to run one. Its text lands in the box for you to read before sending."
          >
            <ul className="space-y-2">
              {plugin.commands.map((command) => (
                <li key={command.name}>
                  <p className="font-mono text-xs text-text-secondary">
                    /{command.name}
                    {command.argumentHint ? (
                      <span className="ml-1.5 text-text-faint">{command.argumentHint}</span>
                    ) : null}
                  </p>
                  {command.description ? (
                    <p className="text-2xs text-text-tertiary">{command.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {plugin.warnings.length > 0 ? (
          <Section title="Warnings">
            <ul className="space-y-1">
              {plugin.warnings.map((warning) => (
                <li key={warning} className="text-2xs text-text-tertiary">
                  {warning}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <p className="mt-6 break-all font-mono text-2xs text-text-faint">{plugin.root}</p>

        <button
          type="button"
          onClick={() => (confirming ? onUninstall() : setConfirming(true))}
          onBlur={() => setConfirming(false)}
          disabled={busy}
          className={cn(
            'mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs',
            confirming
              ? 'border-error-border bg-error-bg text-error-text'
              : 'border-border-default text-text-secondary hover:bg-bg-hover'
          )}
        >
          <TrashIcon className="size-3.5" aria-hidden />
          {confirming ? 'Remove this plugin?' : 'Remove'}
        </button>
      </aside>
    </div>
  );
}

/**
 * What the marketplace offers, and the button to take it.
 *
 * The three non-update answers are shown rather than hidden. A plugin nothing
 * can check is the one that will silently never update, and saying so is the
 * only way a user learns that installing from a folder costs them that.
 */
function UpdateRow({
  update,
  busy,
  onUpdate
}: {
  update: PluginUpdateView;
  busy: boolean;
  onUpdate: () => void;
}) {
  const republished = update.status === 'republished';

  if (update.status === 'update-available' || republished) {
    return (
      <div
        className={cn(
          'mt-2 flex items-center gap-3 rounded-lg border px-3 py-2',
          // Tinted, not alarming. A republished version is worth a second look,
          // not a blocked action: Atlas cannot tell a publisher who forgot to
          // bump from a moved tag, and pretending otherwise would either cry
          // wolf or wave through the case that matters.
          republished ? 'border-warning-border bg-warning-bg' : 'border-border-default bg-bg-surface'
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs text-text-secondary">
            {republished
              ? 'This version was republished'
              : update.available
                ? `Version ${update.available} is available`
                : 'A newer build is available'}
          </p>
          {update.detail ? <p className="text-2xs text-text-faint">{update.detail}</p> : null}
          <ShaTransition update={update} />
        </div>
        <button
          type="button"
          onClick={onUpdate}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-bg-active px-2.5 py-1 text-2xs text-text-primary hover:bg-bg-hover disabled:opacity-50"
        >
          <UpdateIcon className="size-3" aria-hidden />
          Update
        </button>
      </div>
    );
  }

  return (
    <p className="mt-2 px-1 text-2xs text-text-faint">
      {update.status === 'up-to-date' ? 'Up to date.' : (update.detail ?? 'Nothing to check against.')}
    </p>
  );
}

/**
 * The commits an update moves between.
 *
 * Shown because a version string cannot answer "which code": a publisher
 * chooses it, and nothing stops the same string naming two different trees. The
 * commit is the only identifier in the chain the publisher does not get to
 * pick — so it is the one worth putting in front of someone about to run it.
 */
function ShaTransition({ update }: { update: PluginUpdateView }) {
  if (!update.installedSha && !update.availableSha) {
    return null;
  }

  return (
    <p className="mt-0.5 app-code-compact text-2xs text-text-faint">
      {update.installedSha ? update.installedSha.slice(0, 7) : 'unpinned'}
      {' → '}
      {update.availableSha ? update.availableSha.slice(0, 7) : 'unpinned'}
    </p>
  );
}

function ServerRow({ server }: { server: PluginServerSummary }) {
  return (
    <div className="rounded-md border border-border-default p-2">
      <div className="flex items-center gap-2">
        <span className="text-2xs font-medium text-text-secondary">{server.name}</span>
        <span className="rounded bg-bg-hover px-1 text-2xs text-text-faint">{server.transport}</span>
      </div>
      <p className="mt-1 break-all font-mono text-2xs text-text-tertiary">{server.detail}</p>
      {server.envVars.length > 0 || server.envKeys.length > 0 ? (
        <p className="mt-1 text-2xs text-text-faint">
          Environment: {[...server.envVars, ...server.envKeys].join(', ')}
        </p>
      ) : null}
      {server.bearerTokenEnvVar ? (
        <p className="mt-1 text-2xs text-text-faint">
          Needs <span className="font-mono">{server.bearerTokenEnvVar}</span> in your environment.
        </p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  note,
  children
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5">
      <h3 className="text-xs font-medium text-text-secondary">{title}</h3>
      {note ? <p className="mb-2 mt-0.5 text-2xs text-text-faint">{note}</p> : <div className="mb-2" />}
      <div className="space-y-2">{children}</div>
    </section>
  );
}
