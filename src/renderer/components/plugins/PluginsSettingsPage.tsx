import { MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { MarketplacesView, PluginSummary, PluginsView } from '../../../shared/contracts';
import { notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { Switch as UiSwitch } from '../ui/switch';
import { PluginIcon } from './PluginIcon';

const EMPTY_PLUGINS: PluginsView = { root: '', plugins: [], failures: [] };
const EMPTY_MARKETS: MarketplacesView = { marketplaces: [] };

type Tab = 'plugins' | 'mcps' | 'skills' | 'marketplace';

/**
 * Managing what is already installed.
 *
 * Deliberately not the same surface as the Plugins destination. That one is for
 * finding something you do not have yet — a catalogue you browse by category.
 * This is for the list you already own: every plugin, every server it runs,
 * every skill it contributes, each with the one control that matters. Merging
 * the two would make both worse, because "what could I add" and "what is
 * running" are answered by different shapes.
 */
export function PluginsSettingsPage() {
  const [tab, setTab] = useState<Tab>('plugins');
  const [plugins, setPlugins] = useState<PluginsView>(EMPTY_PLUGINS);
  const [markets, setMarkets] = useState<MarketplacesView>(EMPTY_MARKETS);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [nextPlugins, nextMarkets] = await Promise.all([
      window.atlasChat.plugins.list().catch(() => EMPTY_PLUGINS),
      window.atlasChat.plugins.marketplaces().catch(() => EMPTY_MARKETS)
    ]);
    setPlugins(nextPlugins);
    setMarkets(nextMarkets);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (name: string, enabled: boolean) => {
    setBusy(true);
    try {
      setPlugins(await window.atlasChat.plugins.setEnabled(name, enabled));
    } catch (error) {
      notifyError('Could not change the plugin', error);
    } finally {
      setBusy(false);
    }
  };

  const servers = useMemo(
    () => plugins.plugins.flatMap((plugin) => plugin.servers.map((server) => ({ plugin, server }))),
    [plugins.plugins]
  );
  const skills = useMemo(
    () => plugins.plugins.flatMap((plugin) => plugin.skills.map((skill) => ({ plugin, skill }))),
    [plugins.plugins]
  );

  const needle = query.trim().toLowerCase();
  const hit = (...values: Array<string | null | undefined>) =>
    !needle || values.some((value) => (value ?? '').toLowerCase().includes(needle));

  const counts: Record<Tab, number> = {
    plugins: plugins.plugins.length,
    mcps: servers.length,
    skills: skills.length,
    marketplace: markets.marketplaces.length
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1">
          {(['plugins', 'mcps', 'skills', 'marketplace'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTab(option)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                tab === option
                  ? 'bg-bg-active text-text-primary'
                  : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary'
              )}
            >
              {LABELS[option]}
              {/* The count is the point of the tab strip: it answers "is
                  anything even in there" without a click. */}
              <span className="text-2xs text-text-faint">{counts[option]}</span>
            </button>
          ))}
        </nav>

        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg bg-bg-surface px-3 py-1.5 sm:max-w-[280px]">
          <MagnifyingGlassIcon className="size-3.5 shrink-0 text-text-faint" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${LABELS[tab].toLowerCase()}`}
            className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-faint"
          />
        </label>
      </div>

      {plugins.failures.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-error-border bg-error-bg p-3">
          {plugins.failures.map((failure) => (
            <li key={failure.root} className="text-2xs text-error-text">
              {failure.error}
            </li>
          ))}
        </ul>
      ) : null}

      {tab === 'plugins' ? (
        <Rows empty="No plugins installed.">
          {plugins.plugins
            .filter((plugin) => hit(plugin.name, plugin.displayName, plugin.description))
            .map((plugin) => (
              <PluginRow key={plugin.name} plugin={plugin} busy={busy} onToggle={toggle} />
            ))}
        </Rows>
      ) : null}

      {tab === 'mcps' ? (
        <Rows empty="No plugin ships an MCP server.">
          {servers
            .filter(({ plugin, server }) => hit(server.name, server.detail, plugin.name))
            .map(({ plugin, server }) => (
              <Row
                key={server.name}
                icon={<PluginIcon name={plugin.name} iconUrl={plugin.iconUrl} size="sm" />}
                title={server.name}
                badge={server.transport}
                // The literal command or endpoint, never a friendly summary: a
                // bundle must not get to describe itself as harmless.
                subtitle={server.detail}
                trailing={
                  plugin.enabled ? null : <span className="text-2xs text-text-faint">plugin off</span>
                }
              />
            ))}
        </Rows>
      ) : null}

      {tab === 'skills' ? (
        <Rows empty="No skills yet.">
          {skills
            .filter(({ plugin, skill }) => hit(skill.name, skill.description, plugin.name))
            .map(({ plugin, skill }) => (
              <Row
                key={`${plugin.name}:${skill.name}`}
                icon={<PluginIcon name={plugin.name} iconUrl={plugin.iconUrl} size="sm" />}
                title={skill.name}
                badge={plugin.name}
                subtitle={skill.description}
                trailing={
                  skill.implicitInvocation ? null : (
                    <span className="text-2xs text-text-faint">only when you ask</span>
                  )
                }
              />
            ))}
        </Rows>
      ) : null}

      {tab === 'marketplace' ? (
        <Rows empty="No marketplaces added. Add one from the Plugins page.">
          {markets.marketplaces
            .filter((marketplace) => hit(marketplace.name, marketplace.sourceLabel))
            .map((marketplace) => (
              <Row
                key={marketplace.name}
                icon={<PluginIcon name={marketplace.name} iconUrl={null} size="sm" />}
                title={marketplace.displayName ?? marketplace.name}
                badge={marketplace.error ? 'unavailable' : `${marketplace.entries.length} plugins`}
                subtitle={marketplace.error ?? marketplace.sourceLabel}
                mono
              />
            ))}
        </Rows>
      ) : null}
    </div>
  );
}

const LABELS: Record<Tab, string> = {
  plugins: 'Plugins',
  mcps: 'MCPs',
  skills: 'Skills',
  marketplace: 'Marketplace'
};

function PluginRow({
  plugin,
  busy,
  onToggle
}: {
  plugin: PluginSummary;
  busy: boolean;
  onToggle: (name: string, enabled: boolean) => void;
}) {
  return (
    <Row
      icon={<PluginIcon name={plugin.name} iconUrl={plugin.iconUrl} />}
      title={plugin.displayName ?? plugin.name}
      badge={plugin.name !== (plugin.displayName ?? plugin.name) ? plugin.name : undefined}
      subtitle={plugin.description}
      trailing={
        <UiSwitch
          checked={plugin.enabled}
          disabled={busy}
          onCheckedChange={(next) => onToggle(plugin.name, next)}
        />
      }
    />
  );
}

function Row({
  icon,
  title,
  badge,
  subtitle,
  trailing,
  mono
}: {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  subtitle?: string | null;
  trailing?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 py-3">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-sm text-text-primary">
          <span className="truncate">{title}</span>
          {badge ? <span className="shrink-0 text-2xs text-text-faint">{badge}</span> : null}
        </p>
        {subtitle ? (
          <p className={cn('truncate text-xs text-text-tertiary', mono && 'font-mono text-2xs')}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </li>
  );
}

function Rows({ children, empty }: { children: React.ReactNode[]; empty: string }) {
  if (children.length === 0) {
    return (
      <p className="rounded-lg border border-border-default p-8 text-center text-xs text-text-tertiary">
        {empty}
      </p>
    );
  }

  return <ul className="divide-y divide-border-default">{children}</ul>;
}
