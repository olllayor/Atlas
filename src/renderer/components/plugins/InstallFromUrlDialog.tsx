/**
 * Installing a plugin by pasting the link to it.
 *
 * The gap this closes: an Agent Plugins bundle is a directory in somebody's
 * repository, and people find them by browsing a forge. Before this the only
 * ways in were a native folder picker — clone it yourself first — or adding an
 * entire marketplace for one plugin. Neither is what someone means by "install
 * this".
 *
 * Two steps on purpose, and the split is the security design rather than a
 * flourish. **Check** fetches the bundle and reads it; **Install** is a separate
 * press against what was read. Everything shown between the two is derived from
 * the resolved manifest — literal commands, literal endpoints, the commit that
 * was actually fetched — and never from the description its author wrote. A
 * summary built from author-controlled strings is one the author can lie in,
 * which would make the confirmation worse than no confirmation at all.
 */

import { Cross2Icon, DownloadIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { useState } from 'react';

import type { PluginUrlPreview } from '../../../shared/contracts';
import { CONNECTOR_UNAVAILABLE_NOTICE } from '../../../shared/pluginConnectors';
import { cn } from '../../lib/utils';

type InstallFromUrlDialogProps = {
  onClose: () => void;
  /** Runs the install and refreshes the workspace. Resolves when it is done. */
  onInstall: (url: string) => Promise<void>;
};

export function InstallFromUrlDialog({ onClose, onInstall }: InstallFromUrlDialogProps) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<PluginUrlPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    setError(null);
    setPreview(null);

    try {
      setPreview(await window.atlasChat.plugins.previewUrl(url));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    setBusy(true);
    setError(null);

    try {
      await onInstall(url);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  // Editing the link invalidates what was reviewed. Leaving a stale summary on
  // screen beside a changed URL is how someone installs one thing having read
  // the capabilities of another.
  function edit(value: string) {
    setUrl(value);
    setPreview(null);
    setError(null);
  }

  const blocked = Boolean(preview?.blockedReason) || preview?.installed === true;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--overlay)] p-8">
      <div className="mt-16 w-full max-w-xl overflow-hidden rounded-xl border border-border-default bg-bg-base shadow-xl">
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm text-text-primary">Install from a repository</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
          >
            <Cross2Icon className="size-4" aria-hidden />
          </button>
        </header>

        <div className="px-4 py-3">
          <label className="block text-2xs text-text-tertiary" htmlFor="plugin-url">
            Paste the link to a plugin. A folder inside a repository works too.
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="plugin-url"
              value={url}
              onChange={(event) => edit(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && url.trim() && !busy) {
                  void check();
                }
              }}
              placeholder="https://github.com/owner/repo/tree/main/plugins/kanban"
              spellCheck={false}
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-border-default bg-bg-surface px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-faint focus:border-border-strong focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void check()}
              disabled={busy || !url.trim()}
              className="flex shrink-0 items-center gap-1.5 rounded-md bg-bg-active px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover disabled:opacity-50"
            >
              <MagnifyingGlassIcon className="size-3.5" aria-hidden />
              Check
            </button>
          </div>

          {error ? (
            <p className="mt-2 rounded-md border border-error-border bg-error-bg px-2.5 py-1.5 text-2xs text-error-text">
              {error}
            </p>
          ) : null}

          {preview ? <PreviewCard preview={preview} /> : null}
        </div>

        {preview ? (
          <footer className="flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-3">
            <p className="min-w-0 flex-1 text-2xs text-text-faint">
              {preview.blockedReason
                ? preview.blockedReason
                : preview.installed
                  ? `"${preview.name}" is already installed. Remove it first to reinstall.`
                  : 'Installing runs this plugin’s code when its tools are used.'}
            </p>
            <button
              type="button"
              onClick={() => void install()}
              disabled={busy || blocked}
              className="flex shrink-0 items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs text-brand-text hover:opacity-90 disabled:opacity-50"
            >
              <DownloadIcon className="size-3.5" aria-hidden />
              Install {preview.name}
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function PreviewCard({ preview }: { preview: PluginUrlPreview }) {
  return (
    <div className="mt-3 rounded-lg border border-border-default bg-bg-surface p-3">
      <div className="flex items-baseline gap-2">
        <span className="text-sm text-text-primary">{preview.name}</span>
        <span className="text-2xs text-text-faint">{preview.version}</span>
        {/* Worth stating: a bundle read as the open standard is portable, and a
            vendor-format one is being read through a compatibility path. */}
        <span className="ml-auto rounded px-1.5 py-0.5 text-3xs uppercase tracking-wide text-text-faint ring-1 ring-border-subtle">
          {preview.format === 'agent-plugins' ? 'Agent Plugins' : 'vendor format'}
        </span>
      </div>

      {preview.description ? (
        <p className="mt-1 text-2xs text-text-tertiary">{preview.description}</p>
      ) : null}

      <dl className="mt-2.5 space-y-1.5">
        <Row label="Source">
          <span className="app-code-compact break-all">{preview.source}</span>
        </Row>
        <Row label="Commit">
          {/* The one identifier in the chain the publisher does not choose. */}
          <span className="app-code-compact">{preview.sha ? preview.sha.slice(0, 12) : 'unknown'}</span>
        </Row>

        {preview.skills.length > 0 ? (
          <Row label={`Skills (${preview.skills.length})`}>{preview.skills.join(', ')}</Row>
        ) : null}

        {preview.commands.length > 0 ? (
          <Row label={`Commands (${preview.commands.length})`}>{preview.commands.join(', ')}</Row>
        ) : null}

        {preview.servers.map((server) => (
          <Row key={server.key} label={`Runs (${server.transport})`}>
            {/* The literal command or endpoint. Someone deciding whether to
                trust a bundle is entitled to the exact string. */}
            <span className="app-code-compact break-all">{server.detail}</span>
            {server.envVars.length > 0 ? (
              <span className="block text-text-faint">Reads env: {server.envVars.join(', ')}</span>
            ) : null}
            {server.envKeys.length > 0 ? (
              <span className="block text-text-faint">Sets env: {server.envKeys.join(', ')}</span>
            ) : null}
            {server.headerNames.length > 0 ? (
              <span className="block text-text-faint">Sends headers: {server.headerNames.join(', ')}</span>
            ) : null}
          </Row>
        ))}

        {preview.connectors.length > 0 ? (
          <Row label={`Connectors (${preview.connectors.length})`}>
            {preview.connectors.map((connector) => connector.key).join(', ')}
            <span className="block text-warning-text">{CONNECTOR_UNAVAILABLE_NOTICE}</span>
          </Row>
        ) : null}

        {preview.hooksDeclared ? (
          <Row label="Hooks">Declared, and not run. Atlas does not execute plugin hooks.</Row>
        ) : null}
      </dl>

      {preview.skills.length === 0 &&
      preview.commands.length === 0 &&
      preview.servers.length === 0 ? (
        <p className="mt-2 text-2xs text-warning-text">
          This bundle offers nothing Atlas can run. Installing it would do nothing.
        </p>
      ) : null}

      {preview.warnings.length > 0 ? (
        <ul className="mt-2 space-y-0.5 border-t border-border-subtle pt-2">
          {preview.warnings.map((warning) => (
            <li key={warning} className="text-2xs text-warning-text">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={cn('grid grid-cols-[7.5rem_1fr] gap-2 text-2xs')}>
      <dt className="text-text-faint">{label}</dt>
      <dd className="min-w-0 text-text-secondary">{children}</dd>
    </div>
  );
}
