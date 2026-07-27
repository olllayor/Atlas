import { BoxIcon, PlusIcon, ReloadIcon } from '@radix-ui/react-icons';
import { useEffect } from 'react';

import type { SettingsSummary } from '../../../shared/contracts';
import { useProvidersStore } from '../../stores/useProvidersStore';
import { ProviderDetail } from './ProviderDetail';
import { ProviderForm } from './ProviderForm';

type ModelSettingsPageProps = {
  settings: SettingsSummary | null;
  isRefreshingModels: boolean;
  onRefreshModels: () => void;
};

export function ModelSettingsPage({
  settings,
  isRefreshingModels,
  onRefreshModels
}: ModelSettingsPageProps) {
  const providers = useProvidersStore((state) => state.providers);
  const selectedProviderId = useProvidersStore((state) => state.selectedProviderId);
  const isLoading = useProvidersStore((state) => state.isLoading);
  const load = useProvidersStore((state) => state.load);
  const select = useProvidersStore((state) => state.select);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = providers.find((provider) => provider.id === selectedProviderId) ?? null;

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[17px] font-normal text-text-primary">Model settings</h2>
          <p className="mt-1.5 text-[13px] text-text-tertiary">
            Manage custom model providers. Once configured, they can be selected during chat.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefreshModels}
          disabled={isRefreshingModels}
          aria-label="Refresh model catalog"
          className="mt-1 text-text-tertiary transition hover:text-text-primary disabled:opacity-50"
        >
          <ReloadIcon className={`h-4 w-4 ${isRefreshingModels ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="mt-6 flex min-h-[420px] border border-border-default">
        <aside className="w-[220px] shrink-0 border-r border-border-default bg-bg-subtle p-2">
          <RailHeading>Providers</RailHeading>
          {isLoading && providers.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] text-text-muted">Loading…</p>
          ) : null}
          {!isLoading && providers.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] leading-4 text-text-muted">
              No providers yet. Add one to start chatting.
            </p>
          ) : null}

          {providers.map((provider) => (
            <RailItem
              key={provider.id}
              label={provider.name}
              icon={<BoxIcon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />}
              active={provider.id === selectedProviderId}
              // Green only when the provider is both enabled and usable.
              tone={provider.enabled && provider.hasApiKey ? 'ready' : 'idle'}
              onClick={() => select(provider.id)}
            />
          ))}

          <button
            type="button"
            onClick={() => select(null)}
            className={`mt-1 flex w-full items-center gap-2 border border-dashed border-border-default px-2 py-2 text-left text-[12.5px] transition ${
              selectedProviderId === null
                ? 'bg-bg-hover text-text-primary'
                : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary'
            }`}
          >
            <PlusIcon className="h-3.5 w-3.5 shrink-0" />
            Add provider
          </button>
        </aside>

        <div className="min-w-0 flex-1 p-6">
          {selected ? (
            <ProviderDetail provider={selected} />
          ) : (
            <ProviderForm onCreated={() => undefined} />
          )}
        </div>
      </div>
    </div>
  );
}

function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-3 text-[11px] uppercase tracking-[0.12em] text-text-faint first:pt-1">
      {children}
    </div>
  );
}

function RailItem({
  label,
  icon,
  active,
  tone = 'idle',
  onClick
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  tone?: 'ready' | 'idle';
  onClick: () => void;
}) {

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-2 py-2 text-left text-[12.5px] transition ${
        active ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          tone === 'ready' ? 'bg-[var(--text-secondary)]' : 'bg-[var(--text-faint)]'
        }`}
      />
    </button>
  );
}
