import { KeyRound, RefreshCw, X } from 'lucide-react';

import type { SettingsSummary } from '../../shared/contracts';

type SettingsPanelProps = {
  open: boolean;
  settings: SettingsSummary | null;
  keyDraft: string;
  isSaving: boolean;
  isValidating: boolean;
  isRefreshingModels: boolean;
  onClose: () => void;
  onKeyDraftChange: (value: string) => void;
  onSaveKey: () => void;
  onValidateKey: () => void;
  onRefreshModels: () => void;
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
  if (!open) return null;

  const openRouter = settings?.providers.find((p) => p.providerId === 'openrouter');

  return (
    <>
      <div className="fixed inset-0 z-40 bg-overlay transition-opacity" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-border-subtle bg-bg-surface shadow-elevated">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border-subtle px-6 py-5">
            <h2 className="text-lg font-semibold text-text-primary">Settings</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <section>
              <h3 className="section-title">API Key</h3>
              <p className="section-desc">Stored in your OS keychain.</p>

              <div className="mt-4 rounded-xl border border-border-subtle bg-bg-subtle p-4">
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => onKeyDraftChange(e.target.value)}
                  placeholder={openRouter?.hasSecret ? 'A key is saved. Paste to replace.' : 'sk-or-v1-...'}
                  className="input"
                />
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={onSaveKey}
                    disabled={isSaving}
                    className="btn-primary px-3 py-2 text-xs"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={onValidateKey}
                    disabled={isValidating}
                    className="btn-secondary px-3 py-2 text-xs"
                  >
                    {isValidating ? 'Validating...' : 'Validate'}
                  </button>
                </div>
              </div>

              {openRouter && (
                <dl className="mt-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-subtle px-3 py-2">
                    <dt className="text-text-muted">Saved</dt>
                    <dd className="font-medium text-text-primary">{openRouter.hasSecret ? 'Yes' : 'No'}</dd>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-subtle px-3 py-2">
                    <dt className="text-text-muted">Status</dt>
                    <dd className="font-medium text-text-primary">{openRouter.status}</dd>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-subtle px-3 py-2">
                    <dt className="text-text-muted">Last sync</dt>
                    <dd className="font-medium text-text-primary">
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
              )}
            </section>

            <section className="mt-8">
              <h3 className="section-title">Model Catalog</h3>
              <p className="section-desc">Refresh the cached model list.</p>

              <button
                type="button"
                onClick={onRefreshModels}
                disabled={isRefreshingModels}
                className="btn-secondary mt-3 inline-flex items-center gap-2 px-4 py-2 text-xs"
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
