import { ExclamationTriangleIcon, MagnifyingGlassIcon, PlusIcon, ReloadIcon, TrashIcon } from '@radix-ui/react-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  MarketplaceEntryView,
  MarketplaceInput,
  MarketplaceView,
  MarketplacesView
} from '../../../shared/contracts';
import { notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';

const EMPTY: MarketplacesView = { marketplaces: [] };

/** Catalogues run to hundreds of entries; rendering all of them helps nobody. */
const VISIBLE_LIMIT = 60;

/**
 * Browsing and installing from marketplaces.
 *
 * Entries Atlas refuses are shown greyed with the reason rather than filtered
 * out — a catalogue that silently lists fewer plugins than its publisher wrote
 * is worse than one that explains itself.
 */
export function MarketplaceBrowser({ onInstalled }: { onInstalled: () => void }) {
  const [view, setView] = useState<MarketplacesView>(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setView(await window.atlasChat.plugins.marketplaces());
    } catch (error) {
      notifyError('Could not read marketplaces', error);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      setView(await window.atlasChat.plugins.marketplaces());
    } catch (error) {
      notifyError('Marketplace action failed', error);
    } finally {
      setBusy(false);
    }
  };

  const active = view.marketplaces.find((entry) => entry.name === selected) ?? view.marketplaces[0] ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const entries = active?.entries ?? [];

    if (!needle) {
      return entries;
    }

    return entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        (entry.description ?? '').toLowerCase().includes(needle) ||
        (entry.category ?? '').toLowerCase().includes(needle)
    );
  }, [active, query]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-text-tertiary">
          Marketplaces list plugins you can install. Adding one only reads its catalogue — nothing runs
          until you install a plugin.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <SmallButton onClick={() => void load()} disabled={busy}>
            <ReloadIcon className={cn('size-3.5', busy && 'animate-spin')} aria-hidden />
            Refresh
          </SmallButton>
          <SmallButton onClick={() => setAdding((value) => !value)} disabled={busy}>
            <PlusIcon className="size-3.5" aria-hidden />
            Add marketplace
          </SmallButton>
        </div>
      </div>

      {adding ? (
        <AddMarketplaceForm
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={async (input) => {
            await run(() => window.atlasChat.plugins.addMarketplace(input));
            setAdding(false);
            setSelected(input.name);
          }}
        />
      ) : null}

      {view.marketplaces.length === 0 ? (
        <p className="rounded-lg border border-border-default p-6 text-center text-xs text-text-tertiary">
          No marketplaces added yet.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {view.marketplaces.map((marketplace) => (
              <button
                key={marketplace.name}
                type="button"
                onClick={() => setSelected(marketplace.name)}
                className={cn(
                  'rounded-md px-2 py-1 text-xs',
                  active?.name === marketplace.name
                    ? 'bg-bg-active text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover'
                )}
              >
                {marketplace.displayName ?? marketplace.name}
                <span className="ml-1.5 text-2xs text-text-faint">
                  {marketplace.error ? '!' : marketplace.entries.length}
                </span>
              </button>
            ))}
          </div>

          {active ? (
            <MarketplacePanel
              marketplace={active}
              entries={matches}
              query={query}
              busy={busy}
              onQuery={setQuery}
              onRemove={() => void run(() => window.atlasChat.plugins.removeMarketplace(active.name))}
              onInstall={(plugin) =>
                void run(async () => {
                  await window.atlasChat.plugins.installFromMarketplace(active.name, plugin);
                  onInstalled();
                })
              }
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function MarketplacePanel({
  marketplace,
  entries,
  query,
  busy,
  onQuery,
  onRemove,
  onInstall
}: {
  marketplace: MarketplaceView;
  entries: MarketplaceEntryView[];
  query: string;
  busy: boolean;
  onQuery: (value: string) => void;
  onRemove: () => void;
  onInstall: (plugin: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {marketplace.description ? (
            <p className="text-xs text-text-tertiary">{marketplace.description}</p>
          ) : null}
          <p className="mt-0.5 break-all font-mono text-2xs text-text-faint">
            {marketplace.sourceLabel}
            {marketplace.owner ? ` · ${marketplace.owner}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => (confirming ? onRemove() : setConfirming(true))}
          onBlur={() => setConfirming(false)}
          disabled={busy}
          className={cn(
            'shrink-0 rounded-md border px-2 py-1 text-2xs',
            confirming
              ? 'border-error-border bg-error-bg text-error-text'
              : 'border-border-default text-text-secondary hover:bg-bg-hover'
          )}
          aria-label={`Remove ${marketplace.name}`}
        >
          {confirming ? 'Remove?' : <TrashIcon className="size-3.5" aria-hidden />}
        </button>
      </header>

      {marketplace.error ? (
        <p className="flex items-start gap-1.5 rounded-md border border-error-border bg-error-bg p-2 text-2xs text-error-text">
          <ExclamationTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {marketplace.error}
        </p>
      ) : null}

      {marketplace.entries.length > 0 ? (
        <label className="flex items-center gap-2 rounded-md border border-border-default px-2 py-1.5">
          <MagnifyingGlassIcon className="size-3.5 shrink-0 text-text-faint" aria-hidden />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={`Search ${marketplace.entries.length} plugins`}
            className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-faint"
          />
        </label>
      ) : null}

      <ul className="space-y-1.5">
        {entries.slice(0, VISIBLE_LIMIT).map((entry) => (
          <EntryRow key={entry.name} entry={entry} busy={busy} onInstall={() => onInstall(entry.name)} />
        ))}
      </ul>

      {entries.length > VISIBLE_LIMIT ? (
        <p className="text-2xs text-text-faint">
          Showing {VISIBLE_LIMIT} of {entries.length}. Search to narrow the list.
        </p>
      ) : null}

      {marketplace.entries.length > 0 && entries.length === 0 ? (
        <p className="text-2xs text-text-faint">Nothing matches “{query}”.</p>
      ) : null}
    </section>
  );
}

function EntryRow({
  entry,
  busy,
  onInstall
}: {
  entry: MarketplaceEntryView;
  busy: boolean;
  onInstall: () => void;
}) {
  return (
    <li
      className={cn(
        'flex items-start justify-between gap-3 rounded-md border border-border-default p-2',
        entry.blocked && 'opacity-60'
      )}
    >
      <div className="min-w-0">
        <p className="text-xs text-text-secondary">
          {entry.name}
          {entry.version ? <span className="ml-1.5 text-2xs text-text-faint">v{entry.version}</span> : null}
          {entry.category ? (
            <span className="ml-1.5 rounded bg-bg-hover px-1 text-2xs text-text-faint">{entry.category}</span>
          ) : null}
        </p>
        {entry.description ? (
          <p className="mt-0.5 text-2xs text-text-tertiary">{entry.description}</p>
        ) : null}
        <p className="mt-0.5 text-2xs text-text-faint">
          {/* Whether the bundle is pinned to a commit is the part that decides
              whether what installs today is what was reviewed. */}
          From {entry.origin}
          {entry.authOnInstall ? '' : ' · asks for credentials on first use'}
        </p>
        {entry.blocked ? <p className="mt-0.5 text-2xs text-error-text">{entry.blocked}</p> : null}
      </div>

      <div className="shrink-0">
        {entry.installed ? (
          <span className="text-2xs text-text-faint">Installed</span>
        ) : (
          <button
            type="button"
            onClick={onInstall}
            disabled={busy || Boolean(entry.blocked)}
            className="rounded-md border border-border-default px-2 py-1 text-2xs text-text-secondary hover:bg-bg-hover disabled:opacity-40"
          >
            Install
          </button>
        )}
      </div>
    </li>
  );
}

function AddMarketplaceForm({
  busy,
  onCancel,
  onSubmit
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: MarketplaceInput) => void;
}) {
  const [kind, setKind] = useState<'git' | 'path'>('git');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [ref, setRef] = useState('');

  const submit = () => {
    const trimmed = location.trim();

    onSubmit(
      kind === 'git'
        ? { kind: 'git', name: name.trim(), url: trimmed, ref: ref.trim() || null }
        : { kind: 'path', name: name.trim(), path: trimmed }
    );
  };

  return (
    <div className="space-y-2 rounded-lg border border-border-default p-3">
      <div className="flex gap-1.5">
        {(['git', 'path'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setKind(option)}
            className={cn(
              'rounded-md px-2 py-1 text-2xs',
              kind === option ? 'bg-bg-active text-text-primary' : 'text-text-secondary hover:bg-bg-hover'
            )}
          >
            {option === 'git' ? 'Git repository' : 'Local folder'}
          </button>
        ))}
      </div>

      <Field label="Name" value={name} onChange={setName} placeholder="openai-curated" />
      <Field
        label={kind === 'git' ? 'URL' : 'Folder'}
        value={location}
        onChange={setLocation}
        placeholder={kind === 'git' ? 'https://github.com/owner/repo.git' : '/path/to/marketplace'}
      />
      {kind === 'git' ? (
        <Field label="Branch or tag" value={ref} onChange={setRef} placeholder="optional" />
      ) : null}

      <div className="flex justify-end gap-2 pt-1">
        <SmallButton onClick={onCancel} disabled={busy}>
          Cancel
        </SmallButton>
        <SmallButton onClick={submit} disabled={busy || !name.trim() || !location.trim()}>
          Add
        </SmallButton>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-2xs text-text-faint">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full rounded-md border border-border-default bg-transparent px-2 py-1 text-xs text-text-primary outline-none placeholder:text-text-faint focus:border-border-strong"
      />
    </label>
  );
}

function SmallButton({
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
