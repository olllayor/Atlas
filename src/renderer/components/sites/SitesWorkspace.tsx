import {
  DotsHorizontalIcon,
  ExternalLinkIcon,
  PlusIcon,
  ReloadIcon,
  TrashIcon,
} from '@radix-ui/react-icons';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type {
  SiteDetail,
  SiteFileMeta,
  SiteReviewChecklist,
  SiteSummary,
  SiteVersionSummary,
  SiteViolation,
} from '../../../shared/sites';
import { SITE_ENTRY_FILE } from '../../../shared/sites';
import { notify } from '../../lib/notify';
import { useSitesStore } from '../../stores/useSitesStore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { RailBackButton, RailSectionLabel } from '../railPrimitives';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

type RightPanelTab = 'preview' | 'review' | 'versions';

const LABEL_CLASS =
  'text-2xs font-medium uppercase tracking-[var(--tracking-label)] text-text-faint';

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

/** Rejects traversal, absolute paths and anything that would collide. */
function validateFilePath(raw: string, existing: string[]): string | null {
  const path = raw.trim();
  if (!path) {
    return 'Enter a file path.';
  }

  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return 'Use a path relative to the site root.';
  }

  if (path.split('/').some((segment) => segment === '..' || segment === '.')) {
    return 'Path segments cannot be “.” or “..”.';
  }

  if (/[\\:*?"<>|]/.test(path)) {
    return 'That path contains characters the site bundler cannot store.';
  }

  if (existing.includes(path)) {
    return 'A file with that path already exists.';
  }

  return null;
}

function ToolbarButton({
  children,
  disabled,
  onClick,
  title,
  tone = 'default',
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  tone?: 'default' | 'primary' | 'danger';
}) {
  const toneClass =
    tone === 'primary'
      ? 'border-border-strong text-text-primary hover:bg-bg-hover'
      : tone === 'danger'
        ? 'border-border-subtle text-error hover:border-error-border hover:bg-error-bg'
        : 'border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary';

  const button = (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${toneClass}`}
    >
      {children}
    </button>
  );

  if (!title) {
    return button;
  }

  return (
    <Tooltip>
      {/* `span` wrapper: a disabled button fires no pointer events, and the
          explanation is most needed precisely when the button is disabled. */}
      <TooltipTrigger asChild>
        <span className="inline-flex">{button}</span>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

function ViolationRow({ violation }: { violation: SiteViolation }) {
  const isError = violation.severity === 'error';
  return (
    <li className="border-t border-border-subtle py-2 first:border-t-0">
      <div className="flex items-baseline gap-2">
        <span
          className={`shrink-0 text-3xs uppercase tracking-[var(--tracking-label)] ${
            isError ? 'text-error' : 'text-warning-text'
          }`}
        >
          {isError ? 'Error' : 'Warning'}
        </span>
        <span className="font-mono text-2xs text-text-tertiary">{violation.path ?? '(site)'}</span>
      </div>
      <div className="mt-1 text-xs leading-5 text-text-secondary">{violation.message}</div>
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
      <div className="flex items-center justify-between px-3 pb-1.5 pt-5">
        <RailSectionLabel>Sites</RailSectionLabel>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onCreate}
              aria-label="New site"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>New site</TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scroll-container">
        {isLoading && sites.length === 0 ? (
          <div className="px-2 py-3 text-sm text-text-faint">Loading…</div>
        ) : sites.length === 0 ? (
          <div className="px-2 py-3 text-sm leading-5 text-text-faint">
            No sites yet. Create one here, or ask the assistant to build a site in chat.
          </div>
        ) : (
          sites.map((site) => (
            <button
              key={site.id}
              type="button"
              onClick={() => onSelect(site.id)}
              className={`flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                site.id === selectedSiteId
                  ? 'bg-bg-active font-medium text-text-primary'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              }`}
            >
              <span className="w-full truncate text-md">{site.title}</span>
              <span className="text-2xs text-text-faint">
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
        <span className={LABEL_CLASS}>Files</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onCreate}
              aria-label="New file"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>New file</TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 scroll-container">
        {files.length === 0 ? (
          <div className="px-2 py-3 text-xs text-text-faint">No files.</div>
        ) : (
          files.map((file) => (
            <div
              key={file.path}
              className={`group flex items-center gap-1 rounded-md px-2 py-1 transition ${
                file.path === selectedFilePath ? 'bg-bg-hover' : 'hover:bg-bg-hover'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(file.path)}
                className="min-w-0 flex-1 py-1 text-left"
                title={`${file.path} · ${formatBytes(file.byteSize)}`}
              >
                <span
                  className={`block truncate font-mono text-2xs ${
                    file.path === selectedFilePath ? 'text-text-primary' : 'text-text-secondary'
                  }`}
                >
                  {file.path}
                </span>
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onDelete(file.path)}
                    aria-label={`Delete ${file.path}`}
                    className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition hover:bg-error-bg hover:text-error group-focus-within:flex group-hover:flex"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Delete {file.path}</TooltipContent>
              </Tooltip>
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
    return <div className="p-4 text-xs text-text-faint">Build the site to run the review checklist.</div>;
  }

  const outstanding = warningCodes.filter((code) => !acknowledgedWarnings.includes(code));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 scroll-container">
      <div className="text-sm text-text-primary">Review before sharing</div>
      <p className="mt-1 text-xs leading-5 text-text-tertiary">
        Publishing freezes these bytes into an immutable version. Errors block publishing; warnings must be
        acknowledged.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <dt className="text-text-tertiary">Entry file</dt>
        <dd className={review.hasEntryFile ? 'text-text-secondary' : 'text-error'}>
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
          <div className={LABEL_CLASS}>Blocking ({review.validation.errors.length})</div>
          <ul className="mt-2">
            {review.validation.errors.map((error, index) => (
              <ViolationRow key={`${error.code}-${error.path}-${index}`} violation={error} />
            ))}
          </ul>
        </section>
      ) : null}

      {review.validation.warnings.length > 0 ? (
        <section className="mt-5">
          <div className={LABEL_CLASS}>Needs acknowledgement ({outstanding.length} outstanding)</div>
          <ul className="mt-2">
            {review.validation.warnings.map((warning, index) => (
              <ViolationRow key={`${warning.code}-${warning.path}-${index}`} violation={warning} />
            ))}
          </ul>
          <div className="mt-3 space-y-2">
            {warningCodes.map((code) => (
              <label key={code} className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={acknowledgedWarnings.includes(code)}
                  onChange={() => onToggleWarning(code)}
                  className="h-3.5 w-3.5 rounded-sm accent-[var(--accent)]"
                />
                <span>I accept the “{code.replace(/_/g, ' ')}” warnings.</span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {detail.draft?.buildLog ? (
        <section className="mt-5">
          <div className={LABEL_CLASS}>Build log</div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-bg-subtle p-3 font-mono text-2xs leading-5 text-text-tertiary">
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
    <div className="min-h-0 flex-1 overflow-y-auto p-4 scroll-container">
      <div className="text-sm text-text-primary">Version history</div>
      <p className="mt-1 text-xs leading-5 text-text-tertiary">
        Rolling back publishes a new version copied from an older one — the working draft is never overwritten.
      </p>

      <ul className="mt-4">
        {detail.versions.map((version) => {
          const isCurrent = version.id === detail.site.currentVersionId;
          return (
            <li key={version.id} className="border-t border-border-subtle py-3 first:border-t-0">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-text-primary">
                    v{version.versionNo}
                    {version.label ? ` · ${version.label}` : ''}
                    {version.isDraft ? ' · working draft' : ''}
                    {isCurrent ? ' · live' : ''}
                  </div>
                  <div className="mt-0.5 text-2xs text-text-faint">
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

/** Escape/backdrop/focus-trap for free, unlike `window.confirm`. */
function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-[440px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className={tone === 'danger' ? 'text-error' : undefined}>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm leading-5 text-text-tertiary">{description}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-md border border-border-default bg-bg-subtle px-4 text-xs text-text-primary transition hover:bg-bg-hover"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className={`inline-flex h-9 items-center justify-center rounded-md px-4 text-xs transition ${
              tone === 'danger'
                ? 'border border-error-border bg-error-bg text-error-text hover:brightness-125'
                : 'bg-bg-button text-text-inverse hover:bg-bg-button-hover'
            }`}
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The styled replacement for `window.prompt`. */
function PromptDialog({
  open,
  title,
  description,
  label,
  initialValue,
  placeholder,
  confirmLabel = 'Create',
  validate,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue ?? '');
      setError(null);
    }
  }, [initialValue, open]);

  const submit = () => {
    const message = validate?.(value) ?? null;
    if (message) {
      setError(message);
      return;
    }

    onSubmit(value.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label htmlFor="sites-prompt-input" className="block text-sm text-text-tertiary">
            {label}
          </label>
          <input
            id="sites-prompt-input"
            value={value}
            autoFocus
            spellCheck={false}
            placeholder={placeholder}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            className="mt-2 h-9 w-full rounded-md border border-border-default bg-bg-subtle px-3 font-mono text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-border-strong"
          />
          {error ? (
            <p role="alert" className="mt-1.5 text-xs text-error">
              {error}
            </p>
          ) : null}

          <DialogFooter className="mt-5">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border-default bg-bg-subtle px-4 text-xs text-text-primary transition hover:bg-bg-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center rounded-md bg-bg-button px-4 text-xs text-text-inverse transition hover:bg-bg-button-hover"
            >
              {confirmLabel}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type PendingSwitch =
  | { kind: 'site'; siteId: string }
  | { kind: 'file'; path: string }
  | { kind: 'new-file'; path: string };

export function SitesWorkspace({ onBack }: { onBack: () => void }) {
  const {
    acknowledgedWarnings,
    build,
    clearError,
    createDraftFile,
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
  const [creatingSite, setCreatingSite] = useState(false);
  const [creatingFile, setCreatingFile] = useState(false);
  const [pendingSiteDelete, setPendingSiteDelete] = useState(false);
  const [pendingFileDelete, setPendingFileDelete] = useState<string | null>(null);
  const [pendingResetDraft, setPendingResetDraft] = useState<SiteVersionSummary | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);

  useEffect(() => {
    void loadSites();
  }, [loadSites]);

  const canPublish = Boolean(
    review?.canPublish &&
      (review?.validation.warnings ?? []).every((warning) => acknowledgedWarnings.includes(warning.code))
  );

  const existingPaths = detail?.files.map((file) => file.path) ?? [];

  const applySwitch = (target: PendingSwitch) => {
    if (target.kind === 'site') {
      void selectSite(target.siteId);
      return;
    }

    if (target.kind === 'file') {
      void selectFile(target.path);
      return;
    }

    // A brand-new file exists only as an unsaved buffer until it is saved.
    createDraftFile(target.path);
  };

  /** Never lose typed-but-unsaved editor content to a stray click. */
  const requestSwitch = (target: PendingSwitch) => {
    if (fileDirty) {
      setPendingSwitch(target);
      return;
    }

    applySwitch(target);
  };

  const handleExport = async (format: 'folder' | 'zip') => {
    const destination = await exportSite(format);
    if (destination) {
      notify({ tone: 'success', title: 'Site exported', description: destination });
    }
  };

  return (
    <div className="app-shell flex h-screen overflow-hidden bg-bg-base text-text-primary">
      {/*
        Same rail contract as the chat shell and Settings: `--bg-panel`, no
        right border (the colour change is the boundary), no rule under the
        drag strip. This one used to paint `--bg-base` behind a hairline, so
        Sites was the one place the sidebar changed colour under you.
      */}
      <aside className="sidebar-surface flex w-sidebar-width shrink-0 flex-col">
        <div
          className="h-titlebar-height shrink-0"
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        />
        {/* Padded to the same gutter as the list below it, as in Settings. */}
        <div className="px-3">
          <RailBackButton label="Back to chat" onClick={onBack} />
        </div>
        <SiteListPanel
          sites={sites}
          selectedSiteId={selectedSiteId}
          onSelect={(siteId) => requestSwitch({ kind: 'site', siteId })}
          onCreate={() => setCreatingSite(true)}
          isLoading={isLoading}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header
          // Borderless, like the chat and Settings headers: the reference
          // header floats over the content background (spec §1).
          className="titlebar-overlay-safe flex h-titlebar-height shrink-0 items-center justify-between gap-3 px-4"
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        >
          <div className="min-w-0" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
            <div className="truncate text-base text-text-primary">{detail?.site.title ?? 'Sites'}</div>
            {detail ? (
              <div className="text-2xs text-text-faint">
                {STATUS_LABEL[detail.site.status] ?? detail.site.status}
                {detail.current ? ` · live v${detail.current.versionNo}` : ''}
                {detail.draft ? ` · draft ${VERSION_STATE_LABEL[detail.draft.state] ?? detail.draft.state}` : ''}
              </div>
            ) : null}
          </div>

          {detail ? (
            <div
              className="flex shrink-0 items-center gap-1.5"
              style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
            >
              <ToolbarButton onClick={() => void build()} disabled={isBusy} title="Validate the draft">
                <ReloadIcon className="h-3.5 w-3.5" />
                Build
              </ToolbarButton>
              <ToolbarButton
                onClick={() => void openPreviewWindow()}
                disabled={isBusy}
                title="Open the draft in a preview window"
              >
                <ExternalLinkIcon className="h-3.5 w-3.5" />
                Preview
              </ToolbarButton>
              <ToolbarButton
                onClick={() => void publish()}
                disabled={isBusy || !canPublish}
                tone="primary"
                title={canPublish ? 'Publish this draft' : 'Resolve the review checklist first'}
              >
                Publish
              </ToolbarButton>

              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="More actions"
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-border-subtle text-text-secondary transition hover:border-border-default hover:text-text-primary"
                      >
                        <DotsHorizontalIcon className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>More actions</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="min-w-[200px] rounded-md">
                  <DropdownMenuItem disabled={isBusy} onSelect={() => void openInBrowser()}>
                    Open in browser
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isBusy} onSelect={() => void handleExport('folder')}>
                    Export to folder…
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isBusy} onSelect={() => void handleExport('zip')}>
                    Export as .zip…
                  </DropdownMenuItem>
                  {detail.site.status === 'published' ? (
                    <DropdownMenuItem disabled={isBusy} onSelect={() => void unpublish()}>
                      Unpublish
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={isBusy}
                    variant="destructive"
                    onSelect={() => setPendingSiteDelete(true)}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    Delete site…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </header>

        {error ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 border-b border-border-subtle bg-error-bg px-4 py-2"
          >
            <span className="text-xs text-error-text">{error}</span>
            <button
              type="button"
              onClick={clearError}
              className="rounded-md px-1.5 text-xs text-text-tertiary transition hover:text-text-primary"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {!detail ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div className="max-w-[420px]">
              <div className="text-md text-text-primary">No site selected</div>
              <p className="mt-2 text-sm leading-6 text-text-tertiary">
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
              onSelect={(path) => requestSwitch({ kind: 'file', path })}
              onDelete={(path) => setPendingFileDelete(path)}
              onCreate={() => setCreatingFile(true)}
            />

            <section className="flex min-w-0 flex-1 flex-col border-r border-border-subtle">
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-border-subtle px-3">
                <span className="truncate font-mono text-2xs text-text-tertiary">
                  {selectedFilePath ?? 'No file open'}
                  {fileDirty ? ' •' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => void saveFile()}
                  disabled={!fileDirty || isBusy}
                  className="rounded-md px-1.5 text-xs text-text-tertiary transition hover:text-text-primary disabled:opacity-40"
                >
                  Save
                </button>
              </div>

              {selectedFilePath == null ? (
                <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-text-faint">
                  Select a file to edit it.
                </div>
              ) : (
                <textarea
                  value={fileContents ?? ''}
                  onChange={(event) => setFileContents(event.target.value)}
                  spellCheck={false}
                  aria-label={`Contents of ${selectedFilePath}`}
                  className="min-h-0 flex-1 resize-none bg-bg-base p-3 font-mono text-xs leading-5 text-text-primary outline-none scroll-container"
                />
              )}
            </section>

            <section className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border-subtle px-2">
                {(['preview', 'review', 'versions'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    aria-current={rightTab === tab ? 'page' : undefined}
                    onClick={() => setRightTab(tab)}
                    className={`h-7 rounded-md px-2.5 text-xs capitalize transition ${
                      rightTab === tab
                        ? 'bg-bg-hover text-text-primary'
                        : 'text-text-faint hover:text-text-secondary'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
                {rightTab === 'preview' ? (
                  <button
                    type="button"
                    onClick={() => void refreshPreview()}
                    className="ml-auto h-7 rounded-md px-2 text-xs text-text-faint transition hover:text-text-primary"
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
                    /* White is correct here: this iframe renders the user's own
                       site, so it must not inherit app chrome colours. */
                    className="min-h-0 flex-1 border-0 bg-white"
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center text-xs text-text-faint">
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
                  onResetDraft={(version) => setPendingResetDraft(version)}
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

      <PromptDialog
        open={creatingSite}
        title="New site"
        label="Title"
        initialValue="New site"
        placeholder="Landing page"
        validate={(value) => (value.trim() ? null : 'Give the site a title.')}
        onCancel={() => setCreatingSite(false)}
        onSubmit={(title) => {
          setCreatingSite(false);
          void createSite(title);
        }}
      />

      <PromptDialog
        open={creatingFile}
        title="New file"
        description="Paths are relative to the site root. The file lands on disk once you save it."
        label="Path"
        initialValue="page.html"
        placeholder="assets/styles.css"
        validate={(value) => validateFilePath(value, existingPaths)}
        onCancel={() => setCreatingFile(false)}
        onSubmit={(path) => {
          setCreatingFile(false);
          requestSwitch({ kind: 'new-file', path });
        }}
      />

      <ConfirmDialog
        open={pendingSwitch != null}
        title="Discard unsaved edits?"
        description={
          <>
            <span className="block truncate font-mono text-xs text-text-secondary">
              {selectedFilePath}
            </span>
            <span className="mt-1 block">has unsaved changes that will be lost.</span>
          </>
        }
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="danger"
        onCancel={() => setPendingSwitch(null)}
        onConfirm={() => {
          if (pendingSwitch) {
            applySwitch(pendingSwitch);
          }

          setPendingSwitch(null);
        }}
      />

      <ConfirmDialog
        open={pendingFileDelete != null}
        title="Delete this file?"
        description={
          <span className="break-all font-mono text-xs text-text-secondary">{pendingFileDelete}</span>
        }
        confirmLabel="Delete"
        tone="danger"
        onCancel={() => setPendingFileDelete(null)}
        onConfirm={() => {
          if (pendingFileDelete) {
            void deleteFile(pendingFileDelete);
          }

          setPendingFileDelete(null);
        }}
      />

      <ConfirmDialog
        open={pendingSiteDelete}
        title="Delete this site?"
        description={
          <>
            <span className="block truncate font-medium text-text-secondary" title={detail?.site.title}>
              {detail?.site.title}
            </span>
            <span className="mt-1 block">
              It moves to deleted state, stops being previewable, and its published URL stops resolving.
            </span>
          </>
        }
        confirmLabel="Delete site"
        tone="danger"
        onCancel={() => setPendingSiteDelete(false)}
        onConfirm={() => {
          setPendingSiteDelete(false);
          if (detail) {
            void deleteSite(detail.site.id);
          }
        }}
      />

      <ConfirmDialog
        open={pendingResetDraft != null}
        title="Replace the working draft?"
        description={`The draft is overwritten with v${pendingResetDraft?.versionNo ?? ''}. Unsaved draft work is lost.`}
        confirmLabel="Replace draft"
        tone="danger"
        onCancel={() => setPendingResetDraft(null)}
        onConfirm={() => {
          if (pendingResetDraft) {
            void resetDraft(pendingResetDraft.id);
          }

          setPendingResetDraft(null);
        }}
      />
    </div>
  );
}
