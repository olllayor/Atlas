import { ArrowLeftIcon, ExternalLinkIcon, PlusIcon, ReloadIcon, TrashIcon } from '@radix-ui/react-icons';
import { useEffect, useMemo, useState } from 'react';

import type {
  SiteDetail,
  SiteFileMeta,
  SiteReviewChecklist,
  SiteSummary,
  SiteVersionSummary,
  SiteViolation,
} from '../../../shared/sites';
import { SITE_ENTRY_FILE } from '../../../shared/sites';
import { useSitesStore } from '../../stores/useSitesStore';

type RightPanelTab = 'preview' | 'review' | 'versions';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTimestamp(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
  unpublished: 'Unpublished',
  deleted: 'Deleted',
};

const VERSION_STATE_LABEL: Record<string, string> = {
  draft: 'Draft',
  building: 'Building…',
  build_failed: 'Build failed',
  preview_ready: 'Preview ready',
  published: 'Published',
  archived: 'Archived',
};

function ToolbarButton({
  children,
  disabled,
  onClick,
  title,
  tone = 'default',
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  tone?: 'default' | 'primary' | 'danger';
}) {
  const toneClass =
    tone === 'primary'
      ? 'border-border-strong text-text-primary hover:bg-bg-hover'
      : tone === 'danger'
        ? 'border-border-subtle text-text-tertiary hover:border-border-default hover:text-text-primary'
        : 'border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary';

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 border px-3 text-[12.5px] transition disabled:cursor-not-allowed disabled:opacity-40 ${toneClass}`}
    >
      {children}
    </button>
  );
}

function ViolationRow({ violation }: { violation: SiteViolation }) {
  const isError = violation.severity === 'error';
  return (
    <li className="border-t border-border-subtle py-2 first:border-t-0">
      <div className="flex items-baseline gap-2">
        <span
          className={`shrink-0 text-[10px] uppercase tracking-[0.14em] ${
            isError ? 'text-[var(--color-error,#cf2d56)]' : 'text-text-tertiary'
          }`}
        >
          {isError ? 'Error' : 'Warning'}
        </span>
        <span className="font-mono text-[11.5px] text-text-tertiary">{violation.path ?? '(site)'}</span>
      </div>
      <div className="mt-1 text-[12.5px] leading-5 text-text-secondary">{violation.message}</div>
    </li>
  );
}

function SiteListPanel({
  sites,
  selectedSiteId,
  onSelect,
  onCreate,
  isLoading,
}: {
  sites: SiteSummary[];
  selectedSiteId: string | null;
  onSelect: (siteId: string) => void;
  onCreate: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[10px] uppercase tracking-[0.16em] text-text-faint">Sites</span>
        <button
          type="button"
          onClick={onCreate}
          title="New site"
          className="flex h-6 w-6 items-center justify-center text-text-tertiary transition hover:text-text-primary"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {isLoading && sites.length === 0 ? (
          <div className="px-2 py-3 text-[12.5px] text-text-faint">Loading…</div>
        ) : sites.length === 0 ? (
          <div className="px-2 py-3 text-[12.5px] leading-5 text-text-faint">
            No sites yet. Create one here, or ask the assistant to build a site in chat.
          </div>
        ) : (
          sites.map((site) => (
            <button
              key={site.id}
              type="button"
              onClick={() => onSelect(site.id)}
              className={`flex w-full flex-col items-start gap-0.5 px-2.5 py-2 text-left transition ${
                site.id === selectedSiteId
                  ? 'bg-bg-hover text-text-primary'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              }`}
            >
              <span className="w-full truncate text-[13px]">{site.title}</span>
              <span className="text-[11px] text-text-faint">
                {STATUS_LABEL[site.status] ?? site.status} · {formatTimestamp(site.updatedAt)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function FileTreePanel({
  files,
  selectedFilePath,
  onSelect,
  onDelete,
  onCreate,
}: {
  files: SiteFileMeta[];
  selectedFilePath: string | null;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex min-h-0 w-[212px] shrink-0 flex-col border-r border-border-subtle">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[10px] uppercase tracking-[0.16em] text-text-faint">Files</span>
        <button
          type="button"
          onClick={onCreate}
          title="New file"
          className="flex h-6 w-6 items-center justify-center text-text-tertiary transition hover:text-text-primary"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {files.length === 0 ? (
          <div className="px-2 py-3 text-[12px] text-text-faint">No files.</div>
        ) : (
          files.map((file) => (
            <div
              key={file.path}
              className={`group flex items-center gap-1 px-2 py-1.5 transition ${
                file.path === selectedFilePath ? 'bg-bg-hover' : 'hover:bg-bg-hover'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(file.path)}
                className="min-w-0 flex-1 text-left"
                title={`${file.path} · ${formatBytes(file.byteSize)}`}
              >
                <span
                  className={`block truncate font-mono text-[11.5px] ${
                    file.path === selectedFilePath ? 'text-text-primary' : 'text-text-secondary'
                  }`}
                >
                  {file.path}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(file.path)}
                title={`Delete ${file.path}`}
                className="hidden h-5 w-5 shrink-0 items-center justify-center text-text-faint transition hover:text-text-primary group-hover:flex"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ReviewPanel({
  review,
  acknowledgedWarnings,
  onToggleWarning,
  detail,
}: {
  review: SiteReviewChecklist | null;
  acknowledgedWarnings: string[];
  onToggleWarning: (code: SiteViolation['code']) => void;
  detail: SiteDetail;
}) {
  const warningCodes = useMemo(() => {
    const codes = new Set<SiteViolation['code']>();
    for (const warning of review?.validation.warnings ?? []) codes.add(warning.code);
    return [...codes];
  }, [review]);

  if (!review) {
    return <div className="p-4 text-[12.5px] text-text-faint">Build the site to run the review checklist.</div>;
  }

  const outstanding = warningCodes.filter((code) => !acknowledgedWarnings.includes(code));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="text-[13px] text-text-primary">Review before sharing</div>
      <p className="mt-1 text-[12px] leading-5 text-text-tertiary">
        Publishing freezes these bytes into an immutable version. Errors block publishing; warnings must be
        acknowledged.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
        <dt className="text-text-tertiary">Entry file</dt>
        <dd className={review.hasEntryFile ? 'text-text-secondary' : 'text-[var(--color-error,#cf2d56)]'}>
          {review.hasEntryFile ? SITE_ENTRY_FILE : `Missing ${SITE_ENTRY_FILE}`}
        </dd>
        <dt className="text-text-tertiary">Files</dt>
        <dd className="text-text-secondary">{review.fileCount}</dd>
        <dt className="text-text-tertiary">Size</dt>
        <dd className="text-text-secondary">{formatBytes(review.totalBytes)}</dd>
        <dt className="text-text-tertiary">External hosts</dt>
        <dd className="text-text-secondary">{review.externalHosts.length || 'None'}</dd>
        <dt className="text-text-tertiary">Draft state</dt>
        <dd className="text-text-secondary">
          {VERSION_STATE_LABEL[detail.draft?.state ?? ''] ?? detail.draft?.state ?? '—'}
        </dd>
      </dl>

      {review.validation.errors.length > 0 ? (
        <section className="mt-5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-text-faint">
            Blocking ({review.validation.errors.length})
          </div>
          <ul className="mt-2">
            {review.validation.errors.map((error, index) => (
              <ViolationRow key={`${error.code}-${error.path}-${index}`} violation={error} />
            ))}
          </ul>
        </section>
      ) : null}

      {review.validation.warnings.length > 0 ? (
        <section className="mt-5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-text-faint">
            Needs acknowledgement ({outstanding.length} outstanding)
          </div>
          <ul className="mt-2">
            {review.validation.warnings.map((warning, index) => (
              <ViolationRow key={`${warning.code}-${warning.path}-${index}`} violation={warning} />
            ))}
          </ul>
          <div className="mt-3 space-y-2">
            {warningCodes.map((code) => (
              <label key={code} className="flex items-center gap-2 text-[12.5px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={acknowledgedWarnings.includes(code)}
                  onChange={() => onToggleWarning(code)}
                />
                <span>I accept the “{code.replace(/_/g, ' ')}” warnings.</span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {detail.draft?.buildLog ? (
        <section className="mt-5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-text-faint">Build log</div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap border border-border-subtle bg-bg-subtle p-3 font-mono text-[11.5px] leading-5 text-text-tertiary">
            {detail.draft.buildLog}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

function VersionsPanel({
  detail,
  onRollback,
  onResetDraft,
  onPreviewVersion,
  disabled,
}: {
  detail: SiteDetail;
  onRollback: (version: SiteVersionSummary) => void;
  onResetDraft: (version: SiteVersionSummary) => void;
  onPreviewVersion: (version: SiteVersionSummary) => void;
  disabled: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="text-[13px] text-text-primary">Version history</div>
      <p className="mt-1 text-[12px] leading-5 text-text-tertiary">
        Rolling back publishes a new version copied from an older one — the working draft is never overwritten.
      </p>

      <ul className="mt-4">
        {detail.versions.map((version) => {
          const isCurrent = version.id === detail.site.currentVersionId;
          return (
            <li key={version.id} className="border-t border-border-subtle py-3 first:border-t-0">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] text-text-primary">
                    v{version.versionNo}
                    {version.label ? ` · ${version.label}` : ''}
                    {version.isDraft ? ' · working draft' : ''}
                    {isCurrent ? ' · live' : ''}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-text-faint">
                    {VERSION_STATE_LABEL[version.state] ?? version.state} · {version.fileCount} files ·{' '}
                    {formatBytes(version.totalBytes)} ·{' '}
                    {formatTimestamp(version.publishedAt ?? version.updatedAt)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <ToolbarButton onClick={() => onPreviewVersion(version)} disabled={disabled}>
                    Preview
                  </ToolbarButton>
                  {!version.isDraft ? (
                    <>
                      <ToolbarButton onClick={() => onRollback(version)} disabled={disabled || isCurrent}>
                        Roll back
                      </ToolbarButton>
                      <ToolbarButton onClick={() => onResetDraft(version)} disabled={disabled} tone="danger">
                        Reset draft
                      </ToolbarButton>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SitesWorkspace({ onBack }: { onBack: () => void }) {
  const {
    acknowledgedWarnings,
    build,
    clearError,
    createSite,
    deleteFile,
    deleteSite,
    detail,
    error,
    exportSite,
    fileContents,
    fileDirty,
    isBusy,
    isLoading,
    loadSites,
    openInBrowser,
    openPreviewWindow,
    previewNonce,
    previewTarget,
    publish,
    refreshPreview,
    rollback,
    resetDraft,
    review,
    saveFile,
    selectFile,
    selectSite,
    selectedFilePath,
    selectedSiteId,
    setFileContents,
    sites,
    toggleWarningAcknowledged,
    unpublish,
  } = useSitesStore();

  const [rightTab, setRightTab] = useState<RightPanelTab>('preview');

  useEffect(() => {
    void loadSites();
  }, [loadSites]);

  const canPublish = Boolean(
    review?.canPublish &&
      (review?.validation.warnings ?? []).every((warning) => acknowledgedWarnings.includes(warning.code))
  );

  const handleCreateSite = async () => {
    const title = window.prompt('Site title', 'New site');
    if (title == null) return;
    await createSite(title.trim() || 'New site');
  };

  const handleCreateFile = () => {
    const path = window.prompt('New file path', 'page.html');
    if (path == null) return;
    const trimmed = path.trim();
    if (!trimmed) return;
    // Open an empty buffer; the file only lands on disk once the user saves.
    useSitesStore.setState({ selectedFilePath: trimmed, fileContents: '', fileDirty: true });
  };

  const handleDeleteSite = async () => {
    if (!detail) return;
    const confirmed = window.confirm(
      `Delete “${detail.site.title}”? It moves to deleted state and stops being previewable.`
    );
    if (confirmed) await deleteSite(detail.site.id);
  };

  const handleExport = async (format: 'folder' | 'zip') => {
    const destination = await exportSite(format);
    if (destination) window.alert(`Exported to ${destination}`);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-bg-base text-text-primary">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-border-subtle bg-bg-base">
        <div className="h-[52px] shrink-0 border-b border-border-subtle" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary"
        >
          <ArrowLeftIcon className="h-4 w-4 shrink-0" />
          Back to chat
        </button>
        <SiteListPanel
          sites={sites}
          selectedSiteId={selectedSiteId}
          onSelect={(siteId) => void selectSite(siteId)}
          onCreate={() => void handleCreateSite()}
          isLoading={isLoading}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="min-w-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div className="truncate text-[14px] text-text-primary">{detail?.site.title ?? 'Sites'}</div>
            {detail ? (
              <div className="text-[11.5px] text-text-faint">
                {STATUS_LABEL[detail.site.status] ?? detail.site.status}
                {detail.current ? ` · live v${detail.current.versionNo}` : ''}
                {detail.draft ? ` · draft ${VERSION_STATE_LABEL[detail.draft.state] ?? detail.draft.state}` : ''}
              </div>
            ) : null}
          </div>

          {detail ? (
            <div className="flex shrink-0 gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              <ToolbarButton onClick={() => void build()} disabled={isBusy} title="Validate the draft">
                <ReloadIcon className="h-3.5 w-3.5" />
                Build
              </ToolbarButton>
              <ToolbarButton onClick={() => void openPreviewWindow()} disabled={isBusy}>
                <ExternalLinkIcon className="h-3.5 w-3.5" />
                Preview window
              </ToolbarButton>
              <ToolbarButton onClick={() => void openInBrowser()} disabled={isBusy}>
                Open in browser
              </ToolbarButton>
              <ToolbarButton onClick={() => void handleExport('folder')} disabled={isBusy}>
                Export folder
              </ToolbarButton>
              <ToolbarButton onClick={() => void handleExport('zip')} disabled={isBusy}>
                Export .zip
              </ToolbarButton>
              <ToolbarButton
                onClick={() => void publish()}
                disabled={isBusy || !canPublish}
                tone="primary"
                title={canPublish ? 'Publish this draft' : 'Resolve the review checklist first'}
              >
                Publish
              </ToolbarButton>
              {detail.site.status === 'published' ? (
                <ToolbarButton onClick={() => void unpublish()} disabled={isBusy}>
                  Unpublish
                </ToolbarButton>
              ) : null}
              <ToolbarButton onClick={() => void handleDeleteSite()} disabled={isBusy} tone="danger">
                <TrashIcon className="h-3.5 w-3.5" />
              </ToolbarButton>
            </div>
          ) : null}
        </header>

        {error ? (
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle bg-bg-subtle px-4 py-2">
            <span className="text-[12.5px] text-[var(--color-error,#cf2d56)]">{error}</span>
            <button
              type="button"
              onClick={clearError}
              className="text-[12px] text-text-tertiary transition hover:text-text-primary"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {!detail ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div className="max-w-[420px]">
              <div className="text-[15px] text-text-primary">No site selected</div>
              <p className="mt-2 text-[13px] leading-6 text-text-tertiary">
                Sites are multi-file static artifacts with version history. Create one here, or ask the assistant
                in chat — it has site tools and can build, validate, and preview a site for you.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <FileTreePanel
              files={detail.files}
              selectedFilePath={selectedFilePath}
              onSelect={(path) => void selectFile(path)}
              onDelete={(path) => void deleteFile(path)}
              onCreate={handleCreateFile}
            />

            <section className="flex min-w-0 flex-1 flex-col border-r border-border-subtle">
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-border-subtle px-3">
                <span className="truncate font-mono text-[11.5px] text-text-tertiary">
                  {selectedFilePath ?? 'No file open'}
                  {fileDirty ? ' •' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => void saveFile()}
                  disabled={!fileDirty || isBusy}
                  className="text-[12px] text-text-tertiary transition hover:text-text-primary disabled:opacity-40"
                >
                  Save
                </button>
              </div>

              {selectedFilePath == null ? (
                <div className="flex flex-1 items-center justify-center px-6 text-center text-[12.5px] text-text-faint">
                  Select a file to edit it.
                </div>
              ) : (
                <textarea
                  value={fileContents ?? ''}
                  onChange={(event) => setFileContents(event.target.value)}
                  spellCheck={false}
                  className="min-h-0 flex-1 resize-none bg-bg-base p-3 font-mono text-[12px] leading-5 text-text-primary outline-none"
                />
              )}
            </section>

            <section className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border-subtle px-2">
                {(['preview', 'review', 'versions'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setRightTab(tab)}
                    className={`h-7 px-2.5 text-[12px] capitalize transition ${
                      rightTab === tab ? 'text-text-primary' : 'text-text-faint hover:text-text-secondary'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
                {rightTab === 'preview' ? (
                  <button
                    type="button"
                    onClick={() => void refreshPreview()}
                    className="ml-auto h-7 px-2 text-[12px] text-text-faint transition hover:text-text-primary"
                  >
                    Reload
                  </button>
                ) : null}
              </div>

              {rightTab === 'preview' ? (
                previewTarget ? (
                  <iframe
                    // Remount on every refresh so edits show without a manual reload.
                    key={`${previewTarget.versionId}-${previewNonce}`}
                    src={previewTarget.url}
                    title={`${detail.site.title} preview`}
                    // The real boundary is the origin: atlas-site://<siteId> is
                    // never the app's origin, so allow-same-origin only grants
                    // the frame access to itself — which its own `default-src
                    // 'self'` CSP requires to load its stylesheets and scripts.
                    // Popups stay denied so the frame cannot reach shell.openExternal.
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    className="min-h-0 flex-1 border-0 bg-white"
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center text-[12.5px] text-text-faint">
                    No preview available.
                  </div>
                )
              ) : rightTab === 'review' ? (
                <ReviewPanel
                  review={review}
                  acknowledgedWarnings={acknowledgedWarnings}
                  onToggleWarning={toggleWarningAcknowledged}
                  detail={detail}
                />
              ) : (
                <VersionsPanel
                  detail={detail}
                  disabled={isBusy}
                  onRollback={(version) => void rollback(version.id)}
                  onResetDraft={(version) => {
                    if (window.confirm(`Replace the working draft with v${version.versionNo}? Unsaved draft work is lost.`)) {
                      void resetDraft(version.id);
                    }
                  }}
                  onPreviewVersion={(version) => {
                    setRightTab('preview');
                    void refreshPreview(version.id);
                  }}
                />
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
