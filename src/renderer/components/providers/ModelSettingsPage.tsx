import { PlusIcon } from '@radix-ui/react-icons';
import { useCallback, useEffect, useState } from 'react';

import type { ProviderSelection } from '../../stores/useProvidersStore';
import { useProvidersStore } from '../../stores/useProvidersStore';
import { ProviderLogo } from '../../lib/providerLogos';
import { ConfirmDialog } from './ConfirmDialog';
import { LocalAgentsSection } from './LocalAgentsSection';
import { ProviderDetail } from './ProviderDetail';
import { ProviderForm } from './ProviderForm';

/**
 * Settings → Providers.
 *
 * Two kinds of provider, two surfaces, because they have almost nothing in
 * common: local agents are CLIs that sign themselves in and carry their own
 * catalog, while custom endpoints are URLs plus a key. Mixing them into one
 * list meant every row lied about half its neighbours.
 */
export function ModelSettingsPage() {
  const providers = useProvidersStore((state) => state.providers);
  const selectedProviderId = useProvidersStore((state) => state.selectedProviderId);
  const isLoading = useProvidersStore((state) => state.isLoading);
  const load = useProvidersStore((state) => state.load);
  const select = useProvidersStore((state) => state.select);

  const [formDirty, setFormDirty] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<{ next: ProviderSelection } | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const isOnForm = selected == null;

  // Never discard a typed-out provider form because a rail item was clicked.
  const requestSelect = (next: ProviderSelection) => {
    if (next === selectedProviderId) {
      return;
    }

    if (isOnForm && formDirty) {
      setPendingSelection({ next });
      return;
    }

    select(next);
  };

  const handleDirtyChange = useCallback((dirty: boolean) => setFormDirty(dirty), []);

  const hasProviders = providers.length > 0;

  return (
    <div className="space-y-10">
      <LocalAgentsSection />

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-2xs font-medium uppercase tracking-[var(--tracking-label)] text-text-faint">
            Custom endpoints
          </span>
          <span className="text-xs text-text-muted">
            Any OpenAI-, Anthropic- or Responses-compatible API.
          </span>
        </div>

        <div className="mt-3 flex min-h-[420px] rounded-lg border border-border-default">
          <aside className="flex w-[220px] shrink-0 flex-col rounded-l-lg border-r border-border-default bg-bg-subtle p-2">
            <div className="min-h-0 flex-1 overflow-y-auto scroll-container">
              {isLoading && !hasProviders ? (
                <p className="px-2 py-1.5 text-xs text-text-muted">Loading…</p>
              ) : null}

              {providers.map((provider) => (
                <RailItem
                  key={provider.id}
                  label={provider.name}
                  providerId={provider.id}
                  active={provider.id === selectedProviderId}
                  // Green only when the provider is both enabled and usable.
                  tone={provider.enabled && provider.hasApiKey ? 'ready' : 'idle'}
                  onClick={() => requestSelect(provider.id)}
                />
              ))}
            </div>

            {hasProviders ? (
              <button
                type="button"
                onClick={() => requestSelect(null)}
                className={`mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition ${
                  selectedProviderId === null
                    ? 'bg-bg-hover text-text-primary'
                    : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                <PlusIcon className="h-3.5 w-3.5 shrink-0" />
                Add endpoint
              </button>
            ) : null}
          </aside>

          <div className="min-w-0 flex-1 p-6">
            {!hasProviders && !isLoading && isOnForm ? (
              <p className="mb-5 text-sm leading-relaxed text-text-tertiary">
                No endpoints yet. Add one below to start chatting — a name, an endpoint and (usually) a key
                is all it takes.
              </p>
            ) : null}

            {selected ? (
              <ProviderDetail provider={selected} />
            ) : (
              <ProviderForm onCreated={() => setFormDirty(false)} onDirtyChange={handleDirtyChange} />
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingSelection != null}
        title="Discard this provider?"
        description="The name, endpoint, key and staged models you entered have not been saved yet."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="danger"
        onCancel={() => setPendingSelection(null)}
        onConfirm={() => {
          if (pendingSelection) {
            setFormDirty(false);
            select(pendingSelection.next);
          }

          setPendingSelection(null);
        }}
      />
    </div>
  );
}

function RailItem({
  label,
  providerId,
  active,
  tone = 'idle',
  onClick
}: {
  label: string;
  providerId: string;
  active: boolean;
  tone?: 'ready' | 'idle';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition ${
        active ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
      }`}
    >
      <ProviderLogo providerId={providerId} label={label} className="h-3.5 w-3.5 text-text-tertiary" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'ready' ? 'bg-success' : 'bg-text-faint'}`}
      />
    </button>
  );
}
