import { CodeEditorPane } from "./CodeEditorPane";
import { ExportWorkspaceDialog } from "./ExportWorkspaceDialog";
import {
  Crosshair2Icon,
  ChatBubbleIcon,
  MagicWandIcon,
  CodeIcon,
  ColumnsIcon,
  CopyIcon,
  DesktopIcon,
  DotsHorizontalIcon,
  ExternalLinkIcon,
  EyeOpenIcon,
  GridIcon,
  MobileIcon,
  PlusIcon,
  ReloadIcon,
  TrashIcon,
  ViewHorizontalIcon,
} from "@radix-ui/react-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import type {
  SiteDetail,
  SiteFileMeta,
  SiteReviewChecklist,
  SiteSummary,
  SiteVersionSummary,
  SiteViolation,
} from "../../../shared/sites";
import { SITE_ENTRY_FILE } from "../../../shared/sites";
import { DESIGN_TEMPLATES, type DesignTemplate } from "../../../shared/designTemplates";
import { notify } from "../../lib/notify";
import { useSitesStore } from "../../stores/useSitesStore";
import { useAppStore } from "../../stores/useAppStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { RailBackButton, RailSectionLabel } from "../railPrimitives";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

type RightPanelTab = "preview" | "review" | "versions";
type ViewMode = "canvas" | "split" | "code";
type ViewportMode = "desktop" | "tablet" | "mobile" | "multi";
type BackdropMode = "dots" | "grid" | "blank";

const LABEL_CLASS =
  "text-2xs font-medium uppercase tracking-[var(--tracking-label)] text-text-faint";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  unpublished: "Unpublished",
  deleted: "Deleted",
};

const VERSION_STATE_LABEL: Record<string, string> = {
  draft: "Draft",
  building: "Building…",
  build_failed: "Build failed",
  preview_ready: "Preview ready",
  published: "Published",
  archived: "Archived",
};

/** Rejects traversal, absolute paths and anything that would collide. */
function validateFilePath(raw: string, existing: string[]): string | null {
  const path = raw.trim();
  if (!path) {
    return "Enter a file path.";
  }

  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    return "Use a path relative to the site root.";
  }

  if (path.split("/").some((segment) => segment === ".." || segment === ".")) {
    return "Path segments cannot be “.” or “..”.";
  }

  if (/[\\:*?"<>|]/.test(path)) {
    return "That path contains characters the site bundler cannot store.";
  }

  if (existing.includes(path)) {
    return "A file with that path already exists.";
  }

  return null;
}

function ToolbarButton({
  children,
  disabled,
  onClick,
  title,
  tone = "default",
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  tone?: "default" | "primary" | "danger";
}) {
  const toneClass =
    tone === "primary"
      ? "border-border-strong text-text-primary hover:bg-bg-hover"
      : tone === "danger"
        ? "border-border-subtle text-error hover:border-error-border hover:bg-error-bg"
        : "border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary";

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
      <TooltipTrigger asChild>
        <span className="inline-flex">{button}</span>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

function ViolationRow({ violation }: { violation: SiteViolation }) {
  const isError = violation.severity === "error";
  return (
    <li className="border-t border-border-subtle py-2 first:border-t-0">
      <div className="flex items-baseline gap-2">
        <span
          className={`shrink-0 text-3xs uppercase tracking-[var(--tracking-label)] ${
            isError ? "text-error" : "text-warning-text"
          }`}
        >
          {isError ? "Error" : "Warning"}
        </span>
        <span className="font-mono text-2xs text-text-tertiary">{violation.path ?? "(site)"}</span>
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
        <div className="flex items-center gap-2">
          <RailSectionLabel>Design</RailSectionLabel>
          <span className="rounded border border-border-subtle px-1.5 py-0.5 text-3xs font-medium text-text-tertiary">
            Beta
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onCreate}
              aria-label="New design"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>New design</TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scroll-container">
        {isLoading && sites.length === 0 ? (
          <div className="px-2 py-3 text-sm text-text-faint">Loading…</div>
        ) : sites.length === 0 ? (
          <div className="px-2 py-3 text-sm leading-5 text-text-faint">
            No designs yet. Create one here, or ask the assistant to generate a design in chat.
          </div>
        ) : (
          sites.map((site) => (
            <button
              key={site.id}
              type="button"
              onClick={() => onSelect(site.id)}
              className={`flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                site.id === selectedSiteId
                  ? "bg-bg-active font-medium text-text-primary"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
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
    <div className="flex min-h-0 w-[200px] shrink-0 flex-col border-r border-border-subtle bg-bg-surface">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <span className={LABEL_CLASS}>Files</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onCreate}
              aria-label="New file"
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary"
            >
              <PlusIcon className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>New file</TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2 scroll-container">
        {files.length === 0 ? (
          <div className="px-2 py-3 text-xs text-text-faint">No files.</div>
        ) : (
          files.map((file) => (
            <div
              key={file.path}
              className={`group flex items-center gap-1 rounded-md px-2 py-1 transition ${
                file.path === selectedFilePath ? "bg-bg-hover" : "hover:bg-bg-hover"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(file.path)}
                className="min-w-0 flex-1 py-0.5 text-left"
                title={`${file.path} · ${formatBytes(file.byteSize)}`}
              >
                <span
                  className={`block truncate font-mono text-2xs ${
                    file.path === selectedFilePath ? "text-text-primary font-medium" : "text-text-secondary"
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
                    className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-tertiary transition hover:bg-error-bg hover:text-error group-focus-within:flex group-hover:flex"
                  >
                    <TrashIcon className="h-3 w-3" />
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
  onToggleWarning: (code: SiteViolation["code"]) => void;
  detail: SiteDetail;
}) {
  const warningCodes = useMemo(() => {
    const codes = new Set<SiteViolation["code"]>();
    for (const warning of review?.validation.warnings ?? []) codes.add(warning.code);
    return [...codes];
  }, [review]);

  if (!review) {
    return <div className="p-4 text-xs text-text-faint">Build the design to run the review checklist.</div>;
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
        <dd className={review.hasEntryFile ? "text-text-secondary" : "text-error"}>
          {review.hasEntryFile ? SITE_ENTRY_FILE : `Missing ${SITE_ENTRY_FILE}`}
        </dd>
        <dt className="text-text-tertiary">Files</dt>
        <dd className="text-text-secondary">{review.fileCount}</dd>
        <dt className="text-text-tertiary">Size</dt>
        <dd className="text-text-secondary">{formatBytes(review.totalBytes)}</dd>
        <dt className="text-text-tertiary">External hosts</dt>
        <dd className="text-text-secondary">{review.externalHosts.length || "None"}</dd>
        <dt className="text-text-tertiary">Draft state</dt>
        <dd className="text-text-secondary">
          {VERSION_STATE_LABEL[detail.draft?.state ?? ""] ?? detail.draft?.state ?? "—"}
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
                <span>I accept the “{code.replace(/_/g, " ")}” warnings.</span>
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
                    {version.label ? ` · ${version.label}` : ""}
                    {version.isDraft ? " · working draft" : ""}
                    {isCurrent ? " · live" : ""}
                  </div>
                  <div className="mt-0.5 text-2xs text-text-faint">
                    {VERSION_STATE_LABEL[version.state] ?? version.state} · {version.fileCount} files ·{" "}
                    {formatBytes(version.totalBytes)} ·{" "}
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

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-[440px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className={tone === "danger" ? "text-error" : undefined}>{title}</DialogTitle>
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
              tone === "danger"
                ? "border border-error-border bg-error-bg text-error-text hover:brightness-125"
                : "bg-bg-button text-text-inverse hover:bg-bg-button-hover"
            }`}
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PromptDialog({
  open,
  title,
  description,
  label,
  initialValue,
  placeholder,
  confirmLabel = "Create",
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
  const [value, setValue] = useState(initialValue ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue ?? "");
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

function NewDesignDialog({
  open,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  onCancel: () => void;
  onSubmit: (title: string, template: DesignTemplate) => void;
}) {
  const [title, setTitle] = useState("Analytics Dashboard");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("dashboard");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("Analytics Dashboard");
      setSelectedTemplateId("dashboard");
      setError(null);
    }
  }, [open]);

  const selectedTemplate =
    DESIGN_TEMPLATES.find((t) => t.id === selectedTemplateId) ?? DESIGN_TEMPLATES[0];

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Please give your design a title.");
      return;
    }
    onSubmit(trimmed, selectedTemplate);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>New Design</DialogTitle>
            <span className="rounded border border-border-subtle px-1.5 py-0.5 text-3xs font-medium text-text-tertiary">
              Beta
            </span>
          </div>
          <DialogDescription>
            Choose a starter design system template or begin from scratch.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="space-y-4 pt-1"
        >
          <div>
            <label htmlFor="design-title-input" className="block text-xs font-medium text-text-secondary">
              Design Title
            </label>
            <input
              id="design-title-input"
              value={title}
              autoFocus
              spellCheck={false}
              placeholder="e.g. Analytics Dashboard"
              onChange={(event) => {
                setTitle(event.target.value);
                setError(null);
              }}
              className="mt-1.5 h-9 w-full rounded-md border border-border-default bg-bg-subtle px-3 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-border-strong"
            />
            {error ? (
              <p role="alert" className="mt-1 text-xs text-error">
                {error}
              </p>
            ) : null}
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">
              Starter Template
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {DESIGN_TEMPLATES.map((tmpl) => {
                const isSelected = tmpl.id === selectedTemplateId;
                return (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => {
                      setSelectedTemplateId(tmpl.id);
                      if (
                        title === "Analytics Dashboard" ||
                        title === "Marketing Hero" ||
                        title === "Glassmorphic Player" ||
                        title === "Blank Canvas"
                      ) {
                        setTitle(tmpl.name);
                      }
                    }}
                    className={`flex flex-col text-left p-3 rounded-lg border transition ${
                      isSelected
                        ? "border-border-strong bg-bg-hover shadow-xs ring-1 ring-border-strong"
                        : "border-border-subtle bg-bg-surface hover:border-border-default hover:bg-bg-hover"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="text-xs font-medium text-text-primary">{tmpl.name}</span>
                      <span className="text-3xs font-mono uppercase px-1.5 py-0.5 rounded border border-border-subtle text-text-tertiary">
                        {tmpl.category}
                      </span>
                    </div>
                    <p className="text-2xs text-text-tertiary line-clamp-2 leading-relaxed">
                      {tmpl.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-8 rounded-md px-3 text-xs text-text-secondary transition hover:bg-bg-hover hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-8 rounded-md bg-bg-button text-text-inverse px-4 text-xs font-medium transition hover:bg-bg-button-hover"
            >
              Create Design
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CanvasToolbar({
  viewMode,
  setViewMode,
  viewport,
  setViewport,
  zoom,
  setZoom,
  backdrop,
  setBackdrop,
  inspectMode,
  setInspectMode,
  onRefresh,
  onFitZoom,
  onOpenWindow,
  isRefreshing,
}: {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  viewport: ViewportMode;
  setViewport: (v: ViewportMode) => void;
  zoom: number;
  setZoom: (updater: (prev: number) => number) => void;
  backdrop: BackdropMode;
  setBackdrop: (b: BackdropMode) => void;
  inspectMode: boolean;
  setInspectMode: (im: boolean) => void;
  onRefresh: () => void;
  onFitZoom: () => void;
  onOpenWindow?: () => void;
  isRefreshing?: boolean;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-subtle bg-bg-surface px-3">
      {/* View Mode Switcher */}
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1 rounded-md border border-border-subtle bg-bg-base p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("canvas")}
            className={`flex h-6 items-center gap-1 rounded px-2 text-2xs font-medium transition ${
              viewMode === "canvas"
                ? "bg-bg-hover text-text-primary shadow-xs"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            <EyeOpenIcon className="h-3.5 w-3.5" />
            <span>Canvas</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("split")}
            className={`flex h-6 items-center gap-1 rounded px-2 text-2xs font-medium transition ${
              viewMode === "split"
                ? "bg-bg-hover text-text-primary shadow-xs"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            <ColumnsIcon className="h-3.5 w-3.5" />
            <span>Split</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("code")}
            className={`flex h-6 items-center gap-1 rounded px-2 text-2xs font-medium transition ${
              viewMode === "code"
                ? "bg-bg-hover text-text-primary shadow-xs"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            <CodeIcon className="h-3.5 w-3.5" />
            <span>Code</span>
          </button>
        </div>

        {/* Device Viewports */}
        <div className="flex items-center gap-1 rounded-md border border-border-subtle bg-bg-base p-0.5 ml-2">
          <button
            type="button"
            onClick={() => setViewport("desktop")}
            title="Desktop Viewport (100%)"
            className={`flex h-6 items-center gap-1.5 rounded px-2 text-2xs font-medium transition ${
              viewport === "desktop"
                ? "bg-bg-hover text-text-primary shadow-xs"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            <DesktopIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Desktop</span>
          </button>
          <button
            type="button"
            onClick={() => setViewport("tablet")}
            title="iPad Tablet (768 × 1024)"
            className={`flex h-6 items-center gap-1.5 rounded px-2 text-2xs font-medium transition ${
              viewport === "tablet"
                ? "bg-bg-hover text-text-primary shadow-xs"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            <ViewHorizontalIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Tablet</span>
          </button>
          <button
            type="button"
            onClick={() => setViewport("mobile")}
            title="Mobile iPhone (390 × 844)"
            className={`flex h-6 items-center gap-1.5 rounded px-2 text-2xs font-medium transition ${
              viewport === "mobile"
                ? "bg-bg-hover text-text-primary shadow-xs"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            <MobileIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Mobile</span>
          </button>
          <button
            type="button"
            onClick={() => setViewport("multi")}
            title="Multi-Device Artboards View (Mobile, Tablet, Desktop side-by-side)"
            className={`flex h-6 items-center gap-1.5 rounded px-2 text-2xs font-medium transition ${
              viewport === "multi"
                ? "bg-bg-hover text-text-primary shadow-xs"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            <ColumnsIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Multi</span>
          </button>
        </div>

        {/* Inspect Mode Toggle */}
        <button
          type="button"
          onClick={() => setInspectMode(!inspectMode)}
          title="Element Inspector: click nodes in preview to ask Atlas or locate in code"
          className={`flex h-6 items-center gap-1.5 rounded px-2 text-2xs font-medium ml-2 transition border ${
            inspectMode
              ? "bg-accent/15 text-accent border-accent/30 shadow-xs"
              : "border-border-subtle bg-bg-base text-text-tertiary hover:text-text-secondary hover:bg-bg-hover"
          }`}
        >
          <Crosshair2Icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Inspect</span>
        </button>
      </div>

      {/* Right Canvas Tools */}
      <div className="flex items-center gap-2">
        {/* Zoom */}
        <div className="flex items-center gap-1 rounded-md border border-border-subtle bg-bg-base px-1 py-0.5 text-2xs text-text-tertiary">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(40, z - 10))}
            title="Zoom out"
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-bg-hover hover:text-text-primary"
          >
            −
          </button>
          <button
            type="button"
            onClick={onFitZoom}
            title="Fit artboard to screen"
            className="px-1 text-3xs font-medium hover:text-text-primary"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => setZoom(() => 100)}
            title="Reset zoom (100%)"
            className="px-1 text-3xs font-mono hover:text-text-primary"
          >
            {zoom}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(200, z + 10))}
            title="Zoom in"
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-bg-hover hover:text-text-primary"
          >
            +
          </button>
        </div>

        {/* Backdrop Grid */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Canvas background pattern"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
            >
              <GridIcon className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[130px]">
            <DropdownMenuItem onSelect={() => setBackdrop("dots")}>
              Dots Pattern
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setBackdrop("grid")}>
              Grid Lines
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setBackdrop("blank")}>
              Plain Base
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Standalone Window Popout */}
        {onOpenWindow && (
          <button
            type="button"
            onClick={onOpenWindow}
            title="Open preview in dedicated window"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Refresh */}
        <button
          type="button"
          onClick={onRefresh}
          title="Reload preview"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
        >
          <ReloadIcon className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );
}

export type SelectedElementInfo = {
  tagName: string;
  className: string;
  id: string | null;
  selector: string;
  text: string;
  outerHTML: string;
};

function DesignCanvas({
  title,
  previewTarget,
  previewNonce,
  viewport,
  onSetViewport,
  zoom,
  backdrop,
  inspectMode,
  selectedElement,
  onClearSelectedElement,
  onAskAtlas,
  onJumpToCode,
  onCopyMarkup,
}: {
  title: string;
  previewTarget: { versionId: string; url: string } | null;
  previewNonce: number;
  viewport: ViewportMode;
  onSetViewport?: (vp: ViewportMode) => void;
  zoom: number;
  backdrop: BackdropMode;
  inspectMode: boolean;
  selectedElement: SelectedElementInfo | null;
  onClearSelectedElement: () => void;
  onAskAtlas: (el: SelectedElementInfo) => void;
  onJumpToCode: (el: SelectedElementInfo) => void;
  onCopyMarkup: (el: SelectedElementInfo) => void;
}) {
  const singleIframeRef = useRef<HTMLIFrameElement>(null);
  const desktopIframeRef = useRef<HTMLIFrameElement>(null);
  const tabletIframeRef = useRef<HTMLIFrameElement>(null);
  const mobileIframeRef = useRef<HTMLIFrameElement>(null);

  // Soft reload preview via postMessage across all active iframes
  useEffect(() => {
    const refs = [singleIframeRef, desktopIframeRef, tabletIframeRef, mobileIframeRef];
    refs.forEach((ref) => {
      try {
        ref.current?.contentWindow?.postMessage("atlas:reload", "*");
      } catch {}
    });
  }, [previewNonce]);

  // Synchronize inspect mode with preview bridge across all active iframes
  useEffect(() => {
    const refs = [singleIframeRef, desktopIframeRef, tabletIframeRef, mobileIframeRef];
    refs.forEach((ref) => {
      try {
        ref.current?.contentWindow?.postMessage(
          { type: "atlas:toggle_inspect", enabled: inspectMode },
          "*"
        );
      } catch {}
    });
  }, [inspectMode]);

  const getBackdropStyle = (): CSSProperties => {
    if (backdrop === "dots") {
      return {
        backgroundImage: "radial-gradient(var(--border-subtle) 1.2px, transparent 1.2px)",
        backgroundSize: "20px 20px",
      };
    }
    if (backdrop === "grid") {
      return {
        backgroundImage:
          "linear-gradient(var(--border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      };
    }
    return {};
  };

  // Natural dimensions for individual device viewports
  const naturalWidth = viewport === "mobile" ? 392 : viewport === "tablet" ? 770 : 1200;
  const naturalHeight = viewport === "mobile" ? 884 : viewport === "tablet" ? 1064 : 800;
  const scale = zoom / 100;
  const isDesktopFluid = viewport === "desktop" && zoom === 100;

  return (
    <div
      className={`relative flex-1 min-h-0 w-full overflow-auto flex ${
        viewport === "multi" ? "items-start justify-start p-8" : "items-center justify-center p-6"
      } bg-bg-base`}
      style={getBackdropStyle()}
    >
      {previewTarget ? (
        viewport === "multi" ? (
          /* Multi-Artboard Canvas View: Desktop, Tablet, Mobile side-by-side */
          <div
            className="flex items-start justify-center gap-10 min-w-max transition-transform duration-150 m-auto"
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "top center",
            }}
          >
            {/* 1. Desktop Artboard (1200 x 800) */}
            <div className="flex flex-col shrink-0 shadow-2xl rounded-2xl overflow-hidden border border-border-default bg-bg-surface">
              <div className="flex items-center justify-between px-4 py-2.5 bg-bg-surface border-b border-border-subtle select-none">
                <div className="flex items-center gap-2">
                  {/* design-tokens-allow: macOS traffic light window controls */}
                  <span className="size-3 rounded-full bg-[#ff5f57] border border-[#e0443e]/50" />
                  {/* design-tokens-allow: macOS traffic light window controls */}
                  <span className="size-3 rounded-full bg-[#febc2e] border border-[#d89e24]/50" />
                  {/* design-tokens-allow: macOS traffic light window controls */}
                  <span className="size-3 rounded-full bg-[#28c840] border border-[#1aab29]/50" />
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-bg-base border border-border-subtle text-2xs font-mono text-text-secondary">
                  <DesktopIcon className="size-3 text-text-tertiary" />
                  <span>Desktop · 1280 × 800</span>
                </div>
                <button
                  type="button"
                  onClick={() => onSetViewport?.("desktop")}
                  title="Focus Desktop Viewport"
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-medium text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition"
                >
                  <EyeOpenIcon className="size-3" />
                  <span>Focus</span>
                </button>
              </div>
              {/* design-tokens-allow: web preview canvas must have an authentic white background for user site rendering */}
              <div className="w-[1200px] h-[800px] bg-white overflow-hidden">
                {/* design-tokens-allow: web preview iframe must have an authentic white background for user site rendering */}
                <iframe
                  className="w-full h-full border-0 bg-white"
                  ref={desktopIframeRef}
                  key={`${previewTarget.versionId}-desktop`}
                  src={previewTarget.url}
                  title={`${title} desktop preview`}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
              </div>
            </div>

            {/* 2. Tablet Artboard (768 x 1024) */}
            <div className="flex flex-col shrink-0 shadow-2xl rounded-2xl overflow-hidden border border-border-default bg-bg-surface">
              <div className="flex items-center justify-between px-4 py-2.5 bg-bg-surface border-b border-border-subtle select-none">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-border-strong" />
                  <span className="text-2xs font-mono text-text-secondary">iPad Tablet · 768 × 1024</span>
                </div>
                <button
                  type="button"
                  onClick={() => onSetViewport?.("tablet")}
                  title="Focus Tablet Viewport"
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-medium text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition"
                >
                  <EyeOpenIcon className="size-3" />
                  <span>Focus</span>
                </button>
              </div>
              {/* design-tokens-allow: web preview canvas must have an authentic white background for user site rendering */}
              <div className="w-[768px] h-[1024px] bg-white overflow-hidden">
                {/* design-tokens-allow: web preview iframe must have an authentic white background for user site rendering */}
                <iframe
                  className="w-full h-full border-0 bg-white"
                  ref={tabletIframeRef}
                  key={`${previewTarget.versionId}-tablet`}
                  src={previewTarget.url}
                  title={`${title} tablet preview`}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
              </div>
            </div>

            {/* 3. Mobile Artboard (390 x 844) */}
            <div className="flex flex-col shrink-0 shadow-2xl rounded-3xl overflow-hidden border border-border-default bg-bg-surface">
              <div className="flex items-center justify-between px-4 py-2 bg-bg-surface border-b border-border-subtle select-none">
                <div className="flex items-center gap-2">
                  {/* design-tokens-allow: dynamic island simulator */}
                  <span className="w-14 h-3.5 rounded-full bg-black shrink-0" />
                  <span className="text-2xs font-mono text-text-secondary">iPhone · 390 × 844</span>
                </div>
                <button
                  type="button"
                  onClick={() => onSetViewport?.("mobile")}
                  title="Focus Mobile Viewport"
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-medium text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition"
                >
                  <EyeOpenIcon className="size-3" />
                  <span>Focus</span>
                </button>
              </div>
              {/* design-tokens-allow: web preview canvas must have an authentic white background for user site rendering */}
              <div className="w-[390px] h-[844px] bg-white overflow-hidden">
                {/* design-tokens-allow: web preview iframe must have an authentic white background for user site rendering */}
                <iframe
                  className="w-full h-full border-0 bg-white"
                  ref={mobileIframeRef}
                  key={`${previewTarget.versionId}-mobile`}
                  src={previewTarget.url}
                  title={`${title} mobile preview`}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
              </div>
            </div>
          </div>
        ) : (
          /* Single Artboard View */
          <div
            className="relative transition-all duration-150 ease-out"
            style={{
              width: isDesktopFluid ? "100%" : `${naturalWidth * scale}px`,
              height: isDesktopFluid ? "100%" : `${naturalHeight * scale}px`,
              maxWidth: isDesktopFluid ? "1440px" : undefined,
              margin: "auto",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: isDesktopFluid ? "100%" : `${naturalWidth}px`,
                height: isDesktopFluid ? "100%" : `${naturalHeight}px`,
                transform: isDesktopFluid ? undefined : `scale(${scale})`,
                transformOrigin: "top left",
                transition: "transform 150ms ease",
              }}
              className="flex flex-col h-full w-full"
            >
              {/* Device Frame Header for Tablet & Mobile */}
              {viewport !== "desktop" && (
                <div className="w-full flex items-center justify-between px-4 py-2.5 bg-bg-surface border border-border-default rounded-t-2xl text-2xs text-text-tertiary font-mono shrink-0 select-none">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-border-strong" />
                    <span>
                      {viewport === "mobile"
                        ? "390 × 844 · Mobile Viewport"
                        : "768 × 1024 · iPad Tablet"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-success" />
                    <span className="text-3xs text-success font-sans font-medium uppercase">Active</span>
                  </div>
                </div>
              )}

              {/* Exact Viewport Canvas Box */}
              {/* design-tokens-allow: web preview canvas must have an authentic white background for user site rendering */}
              <div
                className={`w-full overflow-hidden bg-white ${
                  viewport === "desktop"
                    ? "h-full rounded-xl border border-border-subtle shadow-lg"
                    : viewport === "tablet"
                      ? "h-[1024px] w-[768px] rounded-b-2xl border-x border-b border-border-default shadow-2xl"
                      : "h-[844px] w-[390px] rounded-b-3xl border-x border-b border-border-default shadow-2xl"
                }`}
              >
                {/* design-tokens-allow: web preview iframe must have an authentic white background for user site rendering */}
                <iframe
                  className="w-full h-full border-0 bg-white"
                  ref={singleIframeRef}
                  key={previewTarget.versionId}
                  src={previewTarget.url}
                  title={`${title} preview`}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
              </div>
            </div>
          </div>
        )
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-text-faint">
          No preview target active.
        </div>
      )}

      {/* Floating Element Inspector Action Bar */}
      {selectedElement && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 rounded-2xl bg-bg-surface/95 backdrop-blur-xl border border-border-default shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 shrink-0">
              &lt;{selectedElement.tagName}
              {selectedElement.className ? `.${selectedElement.className.split(" ")[0]}` : ""}&gt;
            </span>
            <span className="text-xs text-text-muted max-w-[220px] truncate hidden sm:inline">
              {selectedElement.text || selectedElement.selector}
            </span>
          </div>

          <div className="h-4 w-px bg-border-subtle shrink-0" />

          <button
            type="button"
            onClick={() => onAskAtlas(selectedElement)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-accent text-accent-foreground font-medium text-xs hover:opacity-90 transition shrink-0 shadow-xs"
          >
            <MagicWandIcon className="w-3.5 h-3.5" />
            <span>Ask Atlas to Edit</span>
          </button>

          <button
            type="button"
            onClick={() => onJumpToCode(selectedElement)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-border-subtle bg-bg-base hover:bg-bg-hover text-xs text-text-secondary hover:text-text-primary transition shrink-0"
          >
            <CodeIcon className="w-3.5 h-3.5" />
            <span>Code</span>
          </button>

          <button
            type="button"
            onClick={() => onCopyMarkup(selectedElement)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-border-subtle bg-bg-base hover:bg-bg-hover text-xs text-text-secondary hover:text-text-primary transition shrink-0"
          >
            <CopyIcon className="w-3.5 h-3.5" />
            <span>Copy</span>
          </button>

          <button
            type="button"
            onClick={onClearSelectedElement}
            className="text-text-muted hover:text-text-primary text-xs p-1 ml-1"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

type PendingSwitch =
  | { kind: "site"; siteId: string }
  | { kind: "file"; path: string }
  | { kind: "new-file"; path: string };

export function SitesWorkspace({
  onBack,
  onAskAtlas,
}: {
  onBack: () => void;
  onAskAtlas?: (prompt: string) => void;
}) {
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
    getCanvasPrefs,
    updateCanvasPrefs,
  } = useSitesStore();

  const canvasPrefs = getCanvasPrefs(selectedSiteId);
  const viewMode = canvasPrefs.viewMode;
  const viewport = canvasPrefs.viewport;
  const zoom = canvasPrefs.zoom;
  const backdrop = canvasPrefs.backdrop;
  const inspectMode = canvasPrefs.inspectMode;

  const setViewMode = (mode: ViewMode) => {
    if (selectedSiteId) updateCanvasPrefs(selectedSiteId, { viewMode: mode });
  };
  const setViewport = (vp: ViewportMode) => {
    if (selectedSiteId) updateCanvasPrefs(selectedSiteId, { viewport: vp });
  };
  const setZoom = (updater: number | ((prev: number) => number)) => {
    if (!selectedSiteId) return;
    const nextZoom = typeof updater === "function" ? updater(zoom) : updater;
    updateCanvasPrefs(selectedSiteId, { zoom: Math.max(40, Math.min(200, nextZoom)) });
  };
  const setBackdrop = (bd: BackdropMode) => {
    if (selectedSiteId) updateCanvasPrefs(selectedSiteId, { backdrop: bd });
  };
  const setInspectMode = (im: boolean) => {
    if (selectedSiteId) updateCanvasPrefs(selectedSiteId, { inspectMode: im });
  };

  const [selectedElement, setSelectedElement] = useState<SelectedElementInfo | null>(null);

  // Element inspector message listener from iframe preview bridge
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      if (event.data && typeof event.data === "object" && event.data.type === "atlas:element_selected") {
        setSelectedElement(event.data.payload);
      }
    };
    window.addEventListener("message", handleWindowMessage);
    return () => window.removeEventListener("message", handleWindowMessage);
  }, []);

  // Global Cmd+S handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (fileDirty && !isBusy) {
          e.preventDefault();
          void saveFile();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fileDirty, isBusy, saveFile]);

  // Fit to window handler
  const handleFitZoom = (targetViewport: ViewportMode = viewport) => {
    const naturalWidth =
      targetViewport === "mobile"
        ? 392
        : targetViewport === "tablet"
          ? 770
          : targetViewport === "multi"
            ? 2460
            : 1200;
    const naturalHeight =
      targetViewport === "mobile"
        ? 884
        : targetViewport === "tablet"
          ? 1064
          : targetViewport === "multi"
            ? 1100
            : 800;
    const availW = Math.max(320, window.innerWidth - (viewMode === "split" ? 640 : 380));
    const availH = Math.max(300, window.innerHeight - 200);
    const fitRatio = Math.min(availW / naturalWidth, availH / naturalHeight);
    const fitPercent = Math.max(30, Math.min(100, Math.round(fitRatio * 100)));
    setZoom(fitPercent);
  };

  const handleSetViewport = (vp: ViewportMode) => {
    setViewport(vp);
    if (vp === "multi") {
      handleFitZoom("multi");
    } else if (viewport === "multi" && zoom < 60) {
      setZoom(100);
    }
  };

  const handleAskAtlas = (element: SelectedElementInfo) => {
    const siteTitle = detail?.site.title || "the design";
    const prompt = `@sites in "${siteTitle}", please modify the <${element.tagName}> element (${element.selector}):\n\n\`\`\`html\n${element.outerHTML}\n\`\`\`\n`;
    try {
      void navigator.clipboard.writeText(prompt);
      notify({ tone: "success", title: "Prompt copied to clipboard", description: "Ready in chat with @sites" });
    } catch {}

    if (detail?.site.sourceConversationId) {
      void useAppStore.getState().loadConversation(detail.site.sourceConversationId);
    }
    if (onAskAtlas) {
      onAskAtlas(prompt);
    } else {
      onBack();
    }
  };

  const handleJumpToCode = (_element: SelectedElementInfo) => {
    if (viewMode === "canvas") {
      setViewMode("split");
    }
    if (selectedFilePath !== "index.html") {
      void selectFile("index.html");
    }
  };

  const handleCopyMarkup = async (element: SelectedElementInfo) => {
    try {
      await navigator.clipboard.writeText(element.outerHTML);
      notify({ tone: "success", title: "HTML copied", description: `<${element.tagName}> markup copied` });
    } catch {}
  };


  const [rightTab, setRightTab] = useState<RightPanelTab>("review");

  const [creatingSite, setCreatingSite] = useState(false);
  const [creatingFile, setCreatingFile] = useState(false);
  const [pendingSiteDelete, setPendingSiteDelete] = useState(false);
  const [exportWorkspaceOpen, setExportWorkspaceOpen] = useState(false);
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
    if (target.kind === "site") {
      void selectSite(target.siteId);
      return;
    }

    if (target.kind === "file") {
      void selectFile(target.path);
      return;
    }

    createDraftFile(target.path);
  };

  const requestSwitch = (target: PendingSwitch) => {
    if (fileDirty) {
      setPendingSwitch(target);
      return;
    }

    applySwitch(target);
  };

  const handleExport = async (format: "folder" | "zip") => {
    const destination = await exportSite(format);
    if (destination) {
      notify({ tone: "success", title: "Design exported", description: destination });
    }
  };

  const handleCopyCode = async () => {
    if (!fileContents) return;
    try {
      await navigator.clipboard.writeText(fileContents);
      notify({
        tone: "success",
        title: "Code copied",
        description: `${selectedFilePath ?? "File"} copied to clipboard`,
      });
    } catch {
      notify({ tone: "error", title: "Copy failed", description: "Could not access clipboard" });
    }
  };

  const handleCreateDesign = async (title: string, template: DesignTemplate) => {
    setCreatingSite(false);
    await createSite(title, null, template.files);
    notify({
      tone: "success",
      title: "Design created",
      description: `Created "${title}" with ${template.name}`,
    });
  };

  return (
    <div className="app-shell flex h-screen overflow-hidden bg-bg-base text-text-primary">
      {/* Sidebar Rail */}
      <aside className="sidebar-surface flex w-sidebar-width shrink-0 flex-col">
        <div
          className="h-titlebar-height shrink-0"
          style={{ WebkitAppRegion: "drag" } as CSSProperties}
        />
        <div className="px-3">
          <RailBackButton label="Back to chat" onClick={onBack} />
        </div>
        <SiteListPanel
          sites={sites}
          selectedSiteId={selectedSiteId}
          onSelect={(siteId) => requestSwitch({ kind: "site", siteId })}
          onCreate={() => setCreatingSite(true)}
          isLoading={isLoading}
        />
      </aside>

      {/* Main Studio Column */}
      <main className="flex min-w-0 flex-1 flex-col bg-bg-base">
        <header
          className="titlebar-overlay-safe flex h-titlebar-height shrink-0 items-center justify-between gap-3 px-4 border-b border-border-subtle"
          style={{ WebkitAppRegion: "drag" } as CSSProperties}
        >
          {/* Left Title & Status */}
          <div className="min-w-0 flex items-center gap-3" style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
            <div>
              <div className="flex items-center gap-2">
                <div className="truncate text-sm font-medium text-text-primary">
                  {detail?.site.title ?? "Atlas Design"}
                </div>
                <span className="rounded border border-border-subtle px-1.5 py-0.5 text-3xs font-medium text-text-tertiary">
                  Beta
                </span>
              </div>
              {detail ? (
                <div className="text-3xs text-text-faint">
                  {STATUS_LABEL[detail.site.status] ?? detail.site.status}
                  {detail.current ? ` · live v${detail.current.versionNo}` : ""}
                  {detail.draft ? ` · draft ${VERSION_STATE_LABEL[detail.draft.state] ?? detail.draft.state}` : ""}
                </div>
              ) : null}
            </div>
          </div>

          {/* Center View Mode Switcher */}
          {detail ? (
            <div
              className="flex items-center rounded-md border border-border-subtle bg-bg-surface p-0.5"
              style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
            >
              <button
                type="button"
                onClick={() => setViewMode("canvas")}
                className={`flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition ${
                  viewMode === "canvas"
                    ? "bg-bg-hover text-text-primary shadow-xs"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                <EyeOpenIcon className="h-3.5 w-3.5" />
                <span>Canvas</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("split")}
                className={`flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition ${
                  viewMode === "split"
                    ? "bg-bg-hover text-text-primary shadow-xs"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                <ColumnsIcon className="h-3.5 w-3.5" />
                <span>Split</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("code")}
                className={`flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition ${
                  viewMode === "code"
                    ? "bg-bg-hover text-text-primary shadow-xs"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                <CodeIcon className="h-3.5 w-3.5" />
                <span>Code</span>
              </button>
            </div>
          ) : null}

          {/* Right Action Tools */}
          {detail ? (
            <div
              className="flex shrink-0 items-center gap-1.5"
              style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
            >
              <ToolbarButton onClick={() => void build()} disabled={isBusy} title="Validate the design draft">
                <ReloadIcon className="h-3.5 w-3.5" />
                Build
              </ToolbarButton>
              <ToolbarButton
                onClick={() => setExportWorkspaceOpen(true)}
                disabled={isBusy}
                title="Export this design to your active project workspace with package detection"
              >
                <CodeIcon className="h-3.5 w-3.5" />
                Export to Code
              </ToolbarButton>
              <ToolbarButton
                onClick={() => void openPreviewWindow()}
                disabled={isBusy}
                title="Open the design in a standalone window"
              >
                <ExternalLinkIcon className="h-3.5 w-3.5" />
                Preview
              </ToolbarButton>
              <ToolbarButton
                onClick={() => void publish()}
                disabled={isBusy || !canPublish}
                tone="primary"
                title={canPublish ? "Publish this design version" : "Resolve the review checklist first"}
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
                    Open in default browser
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isBusy} onSelect={() => setExportWorkspaceOpen(true)}>
                    Export to Workspace Project…
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isBusy} onSelect={() => void handleExport("folder")}>
                    Export to folder…
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isBusy} onSelect={() => void handleExport("zip")}>
                    Export as .zip…
                  </DropdownMenuItem>
                  {detail.site.status === "published" ? (
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
                    Delete design…
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

        {/* Studio Content Area */}
        {!detail ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="max-w-[460px] space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-bg-surface border border-border-subtle mx-auto grid place-items-center text-xl text-text-primary shadow-sm">
                ✦
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Atlas Design Studio</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-text-tertiary">
                  Create responsive interfaces, inspect mobile and tablet viewports, and iterate live with AI design tools.
                </p>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setCreatingSite(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-bg-button text-text-inverse px-4 py-2 text-xs font-medium transition hover:bg-bg-button-hover shadow-sm"
                >
                  <PlusIcon className="h-4 w-4" />
                  Create New Design
                </button>
              </div>
            </div>
          </div>
        ) : viewMode === "canvas" ? (
          /* Full Canvas View */
          <div className="flex flex-1 min-h-0 flex-col">
            <CanvasToolbar
              viewMode={viewMode}
              setViewMode={setViewMode}
              viewport={viewport}
              setViewport={handleSetViewport}
              zoom={zoom}
              setZoom={setZoom}
              backdrop={backdrop}
              setBackdrop={setBackdrop}
              inspectMode={inspectMode}
              setInspectMode={setInspectMode}
              onRefresh={() => void refreshPreview()}
              onFitZoom={handleFitZoom}
              onOpenWindow={() => void openPreviewWindow()}
              isRefreshing={isBusy}
            />
            <DesignCanvas
              title={detail.site.title}
              previewTarget={previewTarget}
              previewNonce={previewNonce}
              viewport={viewport}
              onSetViewport={handleSetViewport}
              zoom={zoom}
              backdrop={backdrop}
              inspectMode={inspectMode}
              selectedElement={selectedElement}
              onClearSelectedElement={() => setSelectedElement(null)}
              onAskAtlas={handleAskAtlas}
              onJumpToCode={handleJumpToCode}
              onCopyMarkup={(el) => void handleCopyMarkup(el)}
            />
          </div>
        ) : viewMode === "split" ? (
          /* Side-by-Side Split View (Code on Left, Canvas on Right) */
          <div className="flex flex-1 min-h-0">
            {/* Left: File Tree + CodeEditorPane */}
            <div className="flex w-1/2 min-w-[340px] max-w-[640px] border-r border-border-subtle">
              <FileTreePanel
                files={detail.files}
                selectedFilePath={selectedFilePath}
                onSelect={(path) => requestSwitch({ kind: "file", path })}
                onDelete={(path) => setPendingFileDelete(path)}
                onCreate={() => setCreatingFile(true)}
              />

              <div className="flex-1 min-w-0">
                <CodeEditorPane
                  filePath={selectedFilePath}
                  contents={fileContents}
                  dirty={fileDirty}
                  isBusy={isBusy}
                  onContentsChange={setFileContents}
                  onSave={saveFile}
                />
              </div>
            </div>

            {/* Right: Live Responsive Canvas */}
            <div className="flex flex-1 min-h-0 flex-col">
              <CanvasToolbar
                viewMode={viewMode}
                setViewMode={setViewMode}
                viewport={viewport}
                setViewport={handleSetViewport}
                zoom={zoom}
                setZoom={setZoom}
                backdrop={backdrop}
                setBackdrop={setBackdrop}
                inspectMode={inspectMode}
                setInspectMode={setInspectMode}
                onRefresh={() => void refreshPreview()}
                onFitZoom={handleFitZoom}
                onOpenWindow={() => void openPreviewWindow()}
                isRefreshing={isBusy}
              />
              <DesignCanvas
                title={detail.site.title}
                previewTarget={previewTarget}
                previewNonce={previewNonce}
                viewport={viewport}
                onSetViewport={handleSetViewport}
                zoom={zoom}
                backdrop={backdrop}
                inspectMode={inspectMode}
                selectedElement={selectedElement}
                onClearSelectedElement={() => setSelectedElement(null)}
                onAskAtlas={handleAskAtlas}
                onJumpToCode={handleJumpToCode}
                onCopyMarkup={(el) => void handleCopyMarkup(el)}
              />
            </div>
          </div>
        ) : (
          /* Full Code View with Review / Versions Tabs */
          <div className="flex min-h-0 flex-1">
            <FileTreePanel
              files={detail.files}
              selectedFilePath={selectedFilePath}
              onSelect={(path) => requestSwitch({ kind: "file", path })}
              onDelete={(path) => setPendingFileDelete(path)}
              onCreate={() => setCreatingFile(true)}
            />

            <div className="flex-1 min-w-0 border-r border-border-subtle">
              <CodeEditorPane
                filePath={selectedFilePath}
                contents={fileContents}
                dirty={fileDirty}
                isBusy={isBusy}
                onContentsChange={setFileContents}
                onSave={saveFile}
                autoFocus
              />
            </div>

            <section className="flex w-[320px] shrink-0 flex-col">
              <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border-subtle px-2 bg-bg-surface">
                {(["review", "versions"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    aria-current={rightTab === tab ? "page" : undefined}
                    onClick={() => setRightTab(tab)}
                    className={`h-7 rounded-md px-2.5 text-xs capitalize transition ${
                      rightTab === tab
                        ? "bg-bg-hover text-text-primary"
                        : "text-text-faint hover:text-text-secondary"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {rightTab === "review" ? (
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
                    setViewMode("canvas");
                    void refreshPreview(version.id);
                  }}
                />
              )}
            </section>
          </div>
        )}
      </main>

      <NewDesignDialog
        open={creatingSite}
        onCancel={() => setCreatingSite(false)}
        onSubmit={(title, template) => void handleCreateDesign(title, template)}
      />

      <PromptDialog
        open={creatingFile}
        title="New file"
        description="Paths are relative to the design root. The file lands on disk once you save it."
        label="Path"
        initialValue="component.html"
        placeholder="assets/styles.css"
        validate={(value) => validateFilePath(value, existingPaths)}
        onCancel={() => setCreatingFile(false)}
        onSubmit={(path) => {
          setCreatingFile(false);
          requestSwitch({ kind: "new-file", path });
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

      {detail ? (
        <ExportWorkspaceDialog
          open={exportWorkspaceOpen}
          onOpenChange={setExportWorkspaceOpen}
          detail={detail}
        />
      ) : null}

      <ConfirmDialog
        open={pendingSiteDelete}
        title="Delete this design?"
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
        confirmLabel="Delete design"
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
        description={`The draft is overwritten with v${pendingResetDraft?.versionNo ?? ""}. Unsaved draft work is lost.`}
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
