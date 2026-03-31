import { KeyRound, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';

import type { ProviderId, ProviderCredentialSummary, SettingsSummary } from '../../shared/contracts';

type SettingsPanelProps = {
  open: boolean;
  settings: SettingsSummary | null;
  keyDraft: string;
  isSaving: boolean;
  isValidating: boolean;
  isRefreshingModels: boolean;
  onClose: () => void;
  onKeyDraftChange: (value: string) => void;
  onSaveKey: (providerId: ProviderId) => void;
  onValidateKey: (providerId: ProviderId) => void;
  onRefreshModels: () => void;
};

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  gemini: 'Gemini',
  anthropic: 'Anthropic'
};

const PROVIDER_PLACEHOLDERS: Record<ProviderId, string> = {
  openrouter: 'sk-or-v1-...',
  openai: 'sk-...',
  gemini: 'AIza...',
  anthropic: 'sk-ant-...'
};

export function SettingsPanel({
  open,
  settings,
  keyDraft,
  isSaving,
  isValidating,
  isRefreshingModels,
  onClose,
  onKeyDraftChange,
  onSaveKey,
  onValidateKey,
  onRefreshModels,
}: SettingsPanelProps) {
  const [activeProvider, setActiveProvider] = useState<ProviderId>('openrouter');

  if (!open) return null;

  const providerCredential = settings?.providers.find((p) => p.providerId === activeProvider);
  const providers = settings?.providers ?? [];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 transition-opacity" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-white/8 bg-[#0e1115] shadow-2xl">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-white/8 px-6 py-5">
            <h2 className="text-lg font-semibold text-white">Settings</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <section>
              <h3 className="text-sm font-medium text-white">Providers</h3>
              <p className="mt-1 text-xs text-slate-500">Manage API keys for each provider.</p>

              <div className="mt-3 flex flex-wrap gap-2">
                {providers.map((provider) => (
                  <button
                    key={provider.providerId}
                    type="button"
                    onClick={() => setActiveProvider(provider.providerId)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      provider.providerId === activeProvider
                        ? 'bg-white text-black'
                        : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {PROVIDER_LABELS[provider.providerId]}
                    {provider.hasSecret && (
                      <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    )}
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] p-4">
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => onKeyDraftChange(e.target.value)}
                  placeholder={providerCredential?.hasSecret ? 'A key is saved. Paste to replace.' : PROVIDER_PLACEHOLDERS[activeProvider]}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-white/20"
                />
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onSaveKey(activeProvider)}
                    disabled={isSaving}
                    className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onValidateKey(activeProvider)}
                    disabled={isValidating}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isValidating ? 'Validating...' : 'Validate'}
                  </button>
                </div>
              </div>

              {providerCredential && (
                <ProviderStatus provider={providerCredential} settings={settings} />
              )}
            </section>

            <section className="mt-8">
              <h3 className="text-sm font-medium text-white">Model Catalog</h3>
              <p className="mt-1 text-xs text-slate-500">Refresh the cached model list.</p>

              <button
                type="button"
                onClick={onRefreshModels}
                disabled={isRefreshingModels}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingModels ? 'animate-spin' : ''}`} />
                {isRefreshingModels ? 'Refreshing...' : 'Refresh catalog'}
              </button>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

function ProviderStatus({ provider, settings }: { provider: ProviderCredentialSummary; settings: SettingsSummary | null }) {
  return (
    <dl className="mt-4 space-y-2 text-xs">
      <div className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
        <dt className="text-slate-500">Saved</dt>
        <dd className="font-medium text-white">{provider.hasSecret ? 'Yes' : 'No'}</dd>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
        <dt className="text-slate-500">Status</dt>
        <dd className="font-medium text-white">{provider.status}</dd>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
        <dt className="text-slate-500">Last sync</dt>
        <dd className="font-medium text-white">
          {settings?.modelCatalogLastSyncedAt
            ? new Intl.DateTimeFormat('en', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }).format(new Date(settings.modelCatalogLastSyncedAt))
            : 'Never'}
        </dd>
      </div>
    </dl>
  );
}
