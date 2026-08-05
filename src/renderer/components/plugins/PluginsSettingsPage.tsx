import { ExclamationTriangleIcon, ExternalLinkIcon, PlusIcon, ReloadIcon, TrashIcon } from '@radix-ui/react-icons';
import { useCallback, useEffect, useState } from 'react';

import type { PluginServerSummary, PluginSummary, PluginsView } from '../../../shared/contracts';
import { notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { Switch as UiSwitch } from '../ui/switch';
import { MarketplaceBrowser } from './MarketplaceBrowser';

const EMPTY: PluginsView = { root: '', plugins: [], failures: [] };

/**
 * What is installed, and what it is allowed to do.
 *
 * The page is deliberately blunt about capability. A bundle can ship a process
 * that runs on the user's machine, so the server rows show the literal command
 * rather than a friendly summary — everything here comes from the validated
 * manifest and resolved paths, never from the description or display name the
 * plugin author wrote.
 */
export function PluginsSettingsPage() {
  const [view, setView] = useState<PluginsView>(EMPTY);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'installed' | 'browse'>('installed');

  const load = useCallback(async () => {
    const next = await window.atlasChat.plugins.list().catch(() => EMPTY);
    setView(next);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Every mutation returns the whole view, so the page never has to guess what
  // the change did to the rest of the list.
  const run = async (action: () => Promise<PluginsView | null>) => {
    setBusy(true);
    try {
      const next = await action();
      if (next) {
        setView(next);
      }
    } catch (error) {
      notifyError('Plugin action failed', error);
    } finally {
      setBusy(false);
    }
  };

  const selected = view.plugins.find((plugin) => plugin.name === selectedName) ?? view.plugins[0] ?? null;

  const tabs = (
    <div className="flex gap-1.5">
      {(['installed', 'browse'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setTab(option)}
          className={cn(
            'rounded-md px-2 py-1 text-xs',
            tab === option ? 'bg-bg-active text-text-primary' : 'text-text-secondary hover:bg-bg-hover'
          )}
        >
          {option === 'installed' ? `Installed${view.plugins.length ? ` (${view.plugins.length})` : ''}` : 'Browse'}
        </button>
      ))}
    </div>
  );

  if (tab === 'browse') {
    return (
      <div className="space-y-4">
        {tabs}
        <MarketplaceBrowser
          onInstalled={() => {
            // Installing from a catalogue changes the installed list, and the
            // user is one click from looking at it.
            void load();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tabs}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-text-tertiary">
          Plugins bundle skills and tools. They are installed from a folder and run on this machine — only
          install ones you trust.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <ActionButton onClick={() => void load()} disabled={busy}>
            <ReloadIcon className="size-3.5" aria-hidden />
            Rescan
          </ActionButton>
          <ActionButton
            onClick={() => void run(() => window.atlasChat.plugins.installFromPicker())}
            disabled={busy}
          >
            <PlusIcon className="size-3.5" aria-hidden />
            Install from folder
          </ActionButton>
        </div>
      </div>

      {view.failures.length > 0 ? (
        <section className="rounded-lg border border-error-border bg-error-bg p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-error-text">
            <ExclamationTriangleIcon className="size-3.5" aria-hidden />
            {view.failures.length === 1 ? 'A folder could not be loaded' : `${view.failures.length} folders could not be loaded`}
          </h4>
          <ul className="mt-1.5 space-y-1">
            {view.failures.map((failure) => (
              <li key={failure.root} className="text-2xs text-text-tertiary">
                <span className="font-mono">{basename(failure.root)}</span> — {failure.error}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.plugins.length === 0 ? (
        <EmptyState root={view.root} onReveal={() => void window.atlasChat.plugins.revealRoot()} />
      ) : (
        <div className="flex gap-4">
          <nav className="w-52 shrink-0 space-y-1">
            {view.plugins.map((plugin) => (
              <button
                key={plugin.name}
                type="button"
                onClick={() => setSelectedName(plugin.name)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                  selected?.name === plugin.name
                    ? 'bg-bg-active text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover'
                )}
              >
                <span className="min-w-0 truncate">{plugin.displayName ?? plugin.name}</span>
                <span className="shrink-0 text-2xs text-text-faint">
                  {plugin.enabled ? plugin.skills.length || '' : 'off'}
                </span>
              </button>
            ))}
          </nav>

          {selected ? (
            <PluginDetail
              plugin={selected}
              busy={busy}
              onToggle={(enabled) =>
                void run(() => window.atlasChat.plugins.setEnabled(selected.name, enabled))
              }
              onUninstall={() => void run(() => window.atlasChat.plugins.uninstall(selected.name))}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function PluginDetail({
  plugin,
  busy,
  onToggle,
  onUninstall
}: {
  plugin: PluginSummary;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onUninstall: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="min-w-0 flex-1 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-text-primary">
            {plugin.displayName ?? plugin.name}
            <span className="ml-2 text-2xs font-normal text-text-faint">v{plugin.version}</span>
          </h3>
          <p className="mt-0.5 text-xs text-text-tertiary">{plugin.description}</p>
          {plugin.author ? (
            <p className="mt-0.5 text-2xs text-text-faint">by {plugin.author}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <UiSwitch checked={plugin.enabled} onCheckedChange={onToggle} disabled={busy} />
          <button
            type="button"
            onClick={() => (confirming ? onUninstall() : setConfirming(true))}
            onBlur={() => setConfirming(false)}
            disabled={busy}
            className={cn(
              'rounded-md border px-2 py-1 text-2xs',
              confirming
                ? 'border-error-border bg-error-bg text-error-text'
                : 'border-border-default text-text-secondary hover:bg-bg-hover'
            )}
            aria-label={`Remove ${plugin.name}`}
          >
            {confirming ? 'Remove?' : <TrashIcon className="size-3.5" aria-hidden />}
          </button>
        </div>
      </header>

      {plugin.servers.length > 0 ? (
        <Section
          title="Runs on this machine"
          // The point of the page. A server row is the literal command or
          // endpoint, so the decision to trust a bundle is made against what it
          // actually does rather than what it says about itself.
          note="These start when the plugin is enabled and a tool is used."
        >
          <ul className="space-y-2">
            {plugin.servers.map((server) => (
              <ServerRow key={server.name} server={server} />
            ))}
          </ul>
        </Section>
      ) : null}

      {plugin.servers.length > 0 && plugin.skills.length > 0 ? (
        <Section
          title="Tools load on demand"
          note="This plugin's tools stay disconnected until you use one of its skills, so an unused plugin costs nothing. Use the plug icon above a chat to turn them on for that chat, or always."
        >
          <p className="text-2xs text-text-faint">
            Plugins with tools but no skills are always available, because nothing would ever wake them.
          </p>
        </Section>
      ) : null}

      {plugin.hooksDeclared ? (
        <Section title="Hooks">
          <p className="text-2xs text-text-tertiary">
            This plugin declares lifecycle hooks. Atlas does not run them — they are arbitrary commands
            fired on session events with nothing in the loop to approve them.
          </p>
        </Section>
      ) : null}

      {plugin.skills.length > 0 ? (
        <Section title={`Skills (${plugin.skills.length})`} note="Loaded on demand, not held in context.">
          <ul className="space-y-1.5">
            {plugin.skills.map((skill) => (
              <li key={skill.name} className="text-2xs">
                <span className="font-mono text-text-secondary">{skill.name}</span>
                {skill.implicitInvocation ? null : (
                  <span className="ml-1.5 text-text-faint">(only when you ask for it)</span>
                )}
                <p className="mt-0.5 text-text-tertiary">{skill.description}</p>
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

      <p className="font-mono text-2xs text-text-faint">{plugin.root}</p>
    </section>
  );
}

function ServerRow({ server }: { server: PluginServerSummary }) {
  return (
    <li className="rounded-md border border-border-default p-2">
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
          Needs <span className="font-mono">{server.bearerTokenEnvVar}</span> set in your environment.
        </p>
      ) : null}
    </li>
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
    <section>
      <h4 className="text-xs font-medium text-text-secondary">{title}</h4>
      {note ? <p className="mb-1.5 mt-0.5 text-2xs text-text-faint">{note}</p> : <div className="mb-1.5" />}
      {children}
    </section>
  );
}

function EmptyState({ root, onReveal }: { root: string; onReveal: () => void }) {
  return (
    <div className="rounded-lg border border-border-default p-6 text-center">
      <p className="text-xs text-text-tertiary">No plugins installed.</p>
      <p className="mt-1 text-2xs text-text-faint">
        Install one from a folder, or drop a bundle into the plugins directory and rescan.
      </p>
      {root ? (
        <button
          type="button"
          onClick={onReveal}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border-default px-2 py-1 font-mono text-2xs text-text-secondary hover:bg-bg-hover"
        >
          {root}
          <ExternalLinkIcon className="size-3" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  children
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-md border border-border-default px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}
