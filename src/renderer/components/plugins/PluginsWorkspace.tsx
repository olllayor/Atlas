import { GearIcon, MagnifyingGlassIcon, PlusIcon, ReloadIcon } from '@radix-ui/react-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

import type {
  MarketplaceEntryView,
  MarketplaceView,
  MarketplacesView,
  PluginSummary,
  PluginsView
} from '../../../shared/contracts';
import { notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { PluginIcon } from './PluginIcon';
import { PluginDetailPanel } from './PluginDetailPanel';
import { MarketplaceManager } from './MarketplaceManager';

const EMPTY_PLUGINS: PluginsView = { root: '', plugins: [], failures: [] };
const EMPTY_MARKETS: MarketplacesView = { marketplaces: [] };

/** Rows above this in one category collapse behind a "show all". */
const CATEGORY_PREVIEW = 6;

type Tab = 'plugins' | 'skills';

/**
 * Plugins as a destination rather than a settings pane.
 *
 * Installing a plugin is a browsing task — you look through a catalogue, read
 * what something does, and decide. Settings is where you adjust things you have
 * already chosen, and burying a catalogue there makes finding anything a chore.
 */
export function PluginsWorkspace() {
  const [tab, setTab] = useState<Tab>('plugins');
  const [plugins, setPlugins] = useState<PluginsView>(EMPTY_PLUGINS);
  const [markets, setMarkets] = useState<MarketplacesView>(EMPTY_MARKETS);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [nextPlugins, nextMarkets] = await Promise.all([
        window.atlasChat.plugins.list().catch(() => EMPTY_PLUGINS),
        window.atlasChat.plugins.marketplaces().catch(() => EMPTY_MARKETS)
      ]);
      setPlugins(nextPlugins);
      setMarkets(nextMarkets);
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
      await load();
    } catch (error) {
      notifyError('Plugin action failed', error);
    } finally {
      setBusy(false);
    }
  };

  const installedNames = useMemo(
    () => new Set(plugins.plugins.map((plugin) => plugin.name)),
    [plugins.plugins]
  );

  const detail = plugins.plugins.find((plugin) => plugin.name === selected) ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-base text-text-primary">
      <header
        className="relative flex h-titlebar-height shrink-0 items-center justify-between px-5"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          {/* No back control: selecting any chat in the sidebar already leaves
              this view, and a second way out would be one too many. */}
          <nav className="flex gap-1">
            {(['plugins', 'skills'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTab(option)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-sm capitalize transition-colors',
                  tab === option
                    ? 'bg-bg-active text-text-primary'
                    : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary'
                )}
              >
                {option}
              </button>
            ))}
          </nav>
        </div>

        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          <IconButton label="Rescan" onClick={() => void load()} disabled={busy}>
            <ReloadIcon className={cn('size-4', busy && 'animate-spin')} aria-hidden />
          </IconButton>
          <IconButton label="Marketplaces" onClick={() => setManaging(true)}>
            <GearIcon className="size-4" aria-hidden />
          </IconButton>
          <button
            type="button"
            onClick={() => void run(() => window.atlasChat.plugins.installFromPicker())}
            disabled={busy}
            className="ml-1 flex items-center gap-1.5 rounded-lg bg-bg-active px-3 py-1.5 text-sm text-text-primary hover:bg-bg-hover disabled:opacity-50"
          >
            <PlusIcon className="size-4" aria-hidden />
            Install
          </button>
        </div>
      </header>

      <div className="scroll-container min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-8 pb-20">
          <h1 className="pt-6 text-3xl font-normal tracking-[-0.03em]">
            {tab === 'plugins' ? 'Plugins' : 'Skills'}
          </h1>
          <p className="mt-1.5 text-sm text-text-tertiary">
            {tab === 'plugins'
              ? 'Bundles of skills and tools. They run on this machine — only install ones you trust.'
              : 'Instructions your installed plugins contribute. Loaded only when one matches what you are doing.'}
          </p>

          <label className="mt-5 flex items-center gap-2.5 rounded-xl bg-bg-surface px-3.5 py-2.5">
            <MagnifyingGlassIcon className="size-4 shrink-0 text-text-faint" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === 'plugins' ? 'Search plugins' : 'Search skills'}
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-faint"
            />
          </label>

          {plugins.failures.length > 0 ? (
            <ul className="mt-4 space-y-1 rounded-lg border border-error-border bg-error-bg p-3">
              {plugins.failures.map((failure) => (
                <li key={failure.root} className="text-2xs text-error-text">
                  {failure.error}
                </li>
              ))}
            </ul>
          ) : null}

          {tab === 'plugins' ? (
            <PluginsTab
              plugins={plugins}
              markets={markets}
              query={query}
              busy={busy}
              installedNames={installedNames}
              onOpen={setSelected}
              onInstall={(marketplace, plugin) =>
                void run(() =>
                  window.atlasChat.plugins.installFromMarketplace(marketplace, plugin)
                )
              }
              onManage={() => setManaging(true)}
            />
          ) : (
            <SkillsTab plugins={plugins.plugins} query={query} />
          )}
        </div>
      </div>

      {detail ? (
        <PluginDetailPanel
          plugin={detail}
          busy={busy}
          onClose={() => setSelected(null)}
          onToggle={(enabled) =>
            void run(() => window.atlasChat.plugins.setEnabled(detail.name, enabled))
          }
          onUninstall={() =>
            void run(async () => {
              await window.atlasChat.plugins.uninstall(detail.name);
              setSelected(null);
            })
          }
        />
      ) : null}

      {managing ? (
        <MarketplaceManager
          markets={markets}
          busy={busy}
          onClose={() => setManaging(false)}
          onAdd={(input) => void run(() => window.atlasChat.plugins.addMarketplace(input))}
          onRemove={(name) => void run(() => window.atlasChat.plugins.removeMarketplace(name))}
        />
      ) : null}
    </div>
  );
}

function PluginsTab({
  plugins,
  markets,
  query,
  busy,
  installedNames,
  onOpen,
  onInstall,
  onManage
}: {
  plugins: PluginsView;
  markets: MarketplacesView;
  query: string;
  busy: boolean;
  installedNames: Set<string>;
  onOpen: (name: string) => void;
  onInstall: (marketplace: string, plugin: string) => void;
  onManage: () => void;
}) {
  const needle = query.trim().toLowerCase();

  // Catalogue order is meaningful — the spec says an entry's position is how
  // the publisher wants it ranked — so the first rows become "Featured" rather
  // than inventing a ranking of our own.
  const grouped = useMemo(() => groupByCategory(markets.marketplaces, needle), [markets, needle]);

  const installed = plugins.plugins.filter(
    (plugin) => !needle || matchesPlugin(plugin, needle)
  );

  return (
    <div className="mt-7 space-y-8">
      {installed.length > 0 ? (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-base">Installed</h2>
            <button
              type="button"
              onClick={onManage}
              className="rounded-md p-1 text-text-faint hover:bg-bg-hover hover:text-text-secondary"
              aria-label="Manage marketplaces"
            >
              <GearIcon className="size-4" aria-hidden />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {installed.map((plugin) => (
              <button
                key={plugin.name}
                type="button"
                onClick={() => onOpen(plugin.name)}
                title={plugin.displayName ?? plugin.name}
                className={cn(
                  'rounded-xl p-0.5 transition-opacity hover:opacity-80',
                  !plugin.enabled && 'opacity-40'
                )}
              >
                <PluginIcon name={plugin.name} iconUrl={plugin.iconUrl} />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {grouped.length === 0 ? (
        <EmptyCatalog hasMarkets={markets.marketplaces.length > 0} onManage={onManage} query={needle} />
      ) : (
        grouped.map((group) => (
          <CategorySection
            key={group.title}
            group={group}
            busy={busy}
            installedNames={installedNames}
            onInstall={onInstall}
          />
        ))
      )}
    </div>
  );
}

type Group = { title: string; entries: Array<MarketplaceEntryView & { marketplace: string }> };

function CategorySection({
  group,
  busy,
  installedNames,
  onInstall
}: {
  group: Group;
  busy: boolean;
  installedNames: Set<string>;
  onInstall: (marketplace: string, plugin: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? group.entries : group.entries.slice(0, CATEGORY_PREVIEW);

  return (
    <section>
      <h2 className="border-b border-border-default pb-2 text-base">{group.title}</h2>
      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
        {shown.map((entry) => (
          <EntryCard
            key={`${entry.marketplace}/${entry.name}`}
            entry={entry}
            busy={busy}
            installed={installedNames.has(entry.name)}
            onInstall={() => onInstall(entry.marketplace, entry.name)}
          />
        ))}
      </div>
      {group.entries.length > CATEGORY_PREVIEW ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 text-2xs text-text-faint hover:text-text-secondary"
        >
          {expanded ? 'Show less' : `Show all ${group.entries.length}`}
        </button>
      ) : null}
    </section>
  );
}

function EntryCard({
  entry,
  busy,
  installed,
  onInstall
}: {
  entry: MarketplaceEntryView & { marketplace: string };
  busy: boolean;
  installed: boolean;
  onInstall: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-bg-hover',
        entry.blocked && 'opacity-50'
      )}
    >
      <PluginIcon name={entry.name} iconUrl={entry.iconUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text-primary">{entry.name}</p>
        <p className="truncate text-xs text-text-tertiary">
          {entry.description ?? entry.origin}
        </p>
        {entry.blocked ? <p className="mt-0.5 text-2xs text-error-text">{entry.blocked}</p> : null}
      </div>

      <div className="shrink-0 self-center">
        {installed ? (
          <span className="text-2xs text-text-faint">Installed</span>
        ) : (
          <button
            type="button"
            onClick={onInstall}
            disabled={busy || Boolean(entry.blocked)}
            // Hidden until the row is hovered or focused, so a long catalogue
            // is a list of names rather than a wall of buttons.
            className="rounded-md border border-border-default px-2 py-1 text-2xs text-text-secondary opacity-0 transition-opacity hover:bg-bg-active focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
          >
            Install
          </button>
        )}
      </div>
    </div>
  );
}

function SkillsTab({ plugins, query }: { plugins: PluginSummary[]; query: string }) {
  const needle = query.trim().toLowerCase();

  const rows = plugins.flatMap((plugin) =>
    plugin.skills
      .filter(
        (skill) =>
          !needle ||
          skill.name.toLowerCase().includes(needle) ||
          skill.description.toLowerCase().includes(needle)
      )
      .map((skill) => ({ plugin, skill }))
  );

  if (rows.length === 0) {
    return (
      <p className="mt-7 rounded-lg border border-border-default p-8 text-center text-sm text-text-tertiary">
        {plugins.length === 0
          ? 'Install a plugin and its skills appear here.'
          : 'No skills match that search.'}
      </p>
    );
  }

  return (
    <ul className="mt-7 space-y-1">
      {rows.map(({ plugin, skill }) => (
        <li key={`${plugin.name}:${skill.name}`} className="flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-bg-hover">
          <PluginIcon name={plugin.name} iconUrl={plugin.iconUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text-primary">
              {skill.name}
              <span className="ml-2 text-2xs text-text-faint">{plugin.name}</span>
              {skill.implicitInvocation ? null : (
                <span className="ml-2 text-2xs text-text-faint">· only when you ask</span>
              )}
            </p>
            <p className="text-xs text-text-tertiary">{skill.description}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyCatalog({
  hasMarkets,
  onManage,
  query
}: {
  hasMarkets: boolean;
  onManage: () => void;
  query: string;
}) {
  return (
    <div className="rounded-xl border border-border-default p-10 text-center">
      <p className="text-sm text-text-secondary">
        {query ? 'Nothing matches that search.' : hasMarkets ? 'No plugins listed yet.' : 'No marketplaces added.'}
      </p>
      {!query ? (
        <button
          type="button"
          onClick={onManage}
          className="mt-3 rounded-lg border border-border-default px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover"
        >
          {hasMarkets ? 'Manage marketplaces' : 'Add a marketplace'}
        </button>
      ) : null}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function matchesPlugin(plugin: PluginSummary, needle: string): boolean {
  return (
    plugin.name.toLowerCase().includes(needle) ||
    plugin.description.toLowerCase().includes(needle) ||
    (plugin.displayName ?? '').toLowerCase().includes(needle)
  );
}

/**
 * Catalogue entries grouped for display.
 *
 * "Featured" is the head of the catalogue in publisher order rather than a
 * ranking Atlas invents — the format's own spec says an entry's position is how
 * it wants to be shown. Everything else falls under its declared category, and
 * anything uncategorised lands in one bucket at the end instead of vanishing.
 */
function groupByCategory(marketplaces: MarketplaceView[], needle: string): Group[] {
  const all = marketplaces.flatMap((marketplace) =>
    marketplace.entries.map((entry) => ({ ...entry, marketplace: marketplace.name }))
  );

  const matching = needle
    ? all.filter(
        (entry) =>
          entry.name.toLowerCase().includes(needle) ||
          (entry.description ?? '').toLowerCase().includes(needle) ||
          (entry.category ?? '').toLowerCase().includes(needle)
      )
    : all;

  if (matching.length === 0) {
    return [];
  }

  // A search wants one flat list of hits, not the same hits split across six
  // category headings.
  if (needle) {
    return [{ title: `${matching.length} results`, entries: matching }];
  }

  const groups: Group[] = [{ title: 'Featured', entries: matching.slice(0, CATEGORY_PREVIEW) }];
  const byCategory = new Map<string, Group['entries']>();

  for (const entry of matching) {
    const key = entry.category?.trim() || 'Everything else';
    const bucket = byCategory.get(key);

    if (bucket) {
      bucket.push(entry);
    } else {
      byCategory.set(key, [entry]);
    }
  }

  for (const [title, entries] of byCategory) {
    if (title !== 'Everything else') {
      groups.push({ title, entries });
    }
  }

  const rest = byCategory.get('Everything else');

  if (rest) {
    groups.push({ title: 'Everything else', entries: rest });
  }

  return groups;
}
