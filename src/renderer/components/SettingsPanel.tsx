import { KeyRound, RefreshCw, X } from 'lucide-react';

import type { AppUpdateSnapshot, SettingsSummary } from '../../shared/contracts';

type SettingsPanelProps = {
  open: boolean;
  settings: SettingsSummary | null;
  updateState: AppUpdateSnapshot;
  keyDraft: string;
  isSaving: boolean;
  isValidating: boolean;
  isRefreshingModels: boolean;
  onClose: () => void;
  onKeyDraftChange: (value: string) => void;
  onSaveKey: () => void;
  onValidateKey: () => void;
  onCheckForUpdates: () => void;
  onRefreshModels: () => void;
};

export function SettingsPanel({
  open,
  settings,
  updateState,
  keyDraft,
  isSaving,
  isValidating,
  isRefreshingModels,
  onClose,
  onKeyDraftChange,
  onSaveKey,
  onValidateKey,
  onCheckForUpdates,
  onRefreshModels,
}: SettingsPanelProps) {
  if (!open) return null;

  const openRouter = settings?.providers.find((p) => p.providerId === 'openrouter');

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
              <h3 className="text-sm font-medium text-white">API Key</h3>
              <p className="mt-1 text-xs text-slate-500">Stored in your OS keychain.</p>

              <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] p-4">
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => onKeyDraftChange(e.target.value)}
                  placeholder={openRouter?.hasSecret ? 'A key is saved. Paste to replace.' : 'sk-or-v1-...'}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-white/20"
                />
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={onSaveKey}
                    disabled={isSaving}
                    className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={onValidateKey}
                    disabled={isValidating}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isValidating ? 'Validating...' : 'Validate'}
                  </button>
                </div>
              </div>

              {openRouter && (
                <dl className="mt-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
                    <dt className="text-slate-500">Saved</dt>
                    <dd className="font-medium text-white">{openRouter.hasSecret ? 'Yes' : 'No'}</dd>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
                    <dt className="text-slate-500">Status</dt>
                    <dd className="font-medium text-white">{openRouter.status}</dd>
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

            <section className="mt-8">
              <h3 className="section-title">App Updates</h3>
              <p className="section-desc">Check GitHub Releases for the latest macOS build.</p>

              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={onCheckForUpdates}
                  disabled={updateState.status === 'checking'}
                  className="btn-secondary inline-flex items-center gap-2 px-4 py-2 text-xs"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${updateState.status === 'checking' ? 'animate-spin' : ''}`} />
                  {updateState.status === 'checking' ? 'Checking...' : 'Check for updates...'}
                </button>

                {updateState.status === 'available' ? <span className="text-xs text-text-tertiary">Update available</span> : null}

                {updateState.status === 'downloaded' ? (
                  <span className="text-xs text-text-tertiary">Restart required</span>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
