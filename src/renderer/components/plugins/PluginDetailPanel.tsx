import { Cross2Icon, TrashIcon, UpdateIcon } from '@radix-ui/react-icons';
import { useState } from 'react';

import type { PluginServerSummary, PluginSummary, PluginUpdateView } from '../../../shared/contracts';
import { cn } from '../../lib/utils';
import { Switch as UiSwitch } from '../ui/switch';
import { ConnectorList } from './ConnectorList';
import { PluginIcon } from './PluginIcon';

/**
 * One plugin, and what it is allowed to do.
 *
 * Everything shown is derived from the validated manifest and resolved paths.
 * The server rows in particular carry the literal command or endpoint, never a
 * friendly summary — a bundle must not be able to describe itself as harmless.
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--overlay)]" onClick={onClose}>
      <aside
        className="scroll-container h-full w-[460px] max-w-full overflow-y-auto bg-bg-base p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <PluginIcon name={plugin.name} iconUrl={plugin.iconUrl} />
            <div className="min-w-0">
              <h2 className="truncate text-base text-text-primary">
                {plugin.displayName ?? plugin.name}
              </h2>
              <p className="text-2xs text-text-faint">
                v{plugin.version}
                {plugin.author ? ` · ${plugin.author}` : ''}
              </p>
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
          // Above the switch, because it is the reason the switch is dead. A
          // revocation is not a preference the user can toggle back on.
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

        {update && !plugin.blockedReason ? (
          <UpdateRow update={update} busy={busy} onUpdate={onUpdate} />
        ) : null}

        {plugin.servers.length > 0 ? (
          <Section
            title="Runs on this machine"
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
