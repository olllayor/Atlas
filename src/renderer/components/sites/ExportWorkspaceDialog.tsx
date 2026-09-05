import { useState, useEffect } from "react";
import {
  CheckCircledIcon,
  CodeIcon,
  CopyIcon,
  ExternalLinkIcon,
  ReloadIcon,
  ArrowRightIcon,
  FileTextIcon,
} from "@radix-ui/react-icons";

import type {
  ExportSiteToWorkspaceResult,
  SiteDetail,
  WorkspaceProjectAnalysis,
} from "../../../shared/sites";
import { notify } from "../../lib/notify";
import { useAppStore } from "../../stores/useAppStore";
import { useSitesStore } from "../../stores/useSitesStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ExportWorkspaceDialog({
  open,
  onOpenChange,
  detail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: SiteDetail;
}) {
  const projects = useAppStore((state) => state.projects);
  const createConversationInProject = useAppStore(
    (state) => state.createConversationInProject
  );
  const { analyzeWorkspace, exportToWorkspace } = useSitesStore();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => {
      if (projects.length > 0) return projects[0].id;
      return null;
    }
  );
  const [subpath, setSubpath] = useState(`src/components/design/${detail.site.slug}`);
  const [analysis, setAnalysis] = useState<WorkspaceProjectAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportSiteToWorkspaceResult | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // Initialize or synchronize project selection
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  // Analyze workspace whenever selected project changes
  useEffect(() => {
    if (!open) {
      setExportResult(null);
      return;
    }

    if (!selectedProject) {
      setAnalysis(null);
      return;
    }

    let active = true;
    setIsAnalyzing(true);

    void analyzeWorkspace(selectedProject.root, detail.draft?.id ?? detail.site.currentVersionId).then(
      (res) => {
        if (!active) return;
        setIsAnalyzing(false);
        if (res) {
          setAnalysis(res);
          setSubpath(res.defaultExportSubpath);
        }
      }
    );

    return () => {
      active = false;
    };
  }, [open, selectedProject?.root, detail.draft?.id, detail.site.currentVersionId]);

  const handleCopyInstall = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCmd(true);
      notify({ tone: "success", title: "Copied install command" });
      setTimeout(() => setCopiedCmd(false), 2000);
    } catch {
      notify({ tone: "error", title: "Failed to copy to clipboard" });
    }
  };

  const handleExport = async () => {
    if (!selectedProject || !subpath.trim()) return;

    setIsExporting(true);
    const result = await exportToWorkspace(
      selectedProject.root,
      subpath.trim(),
      detail.draft?.id ?? detail.site.currentVersionId
    );
    setIsExporting(false);

    if (result) {
      setExportResult(result);
      notify({
        tone: "success",
        title: "Exported to Project",
        description: `${result.writtenFiles.length} files written to ${subpath}`,
      });
    }
  };

  const handleRevealInFinder = async () => {
    if (!selectedProjectId) return;
    try {
      await window.atlasChat.projects.reveal(selectedProjectId);
    } catch {
      notify({ tone: "error", title: "Could not open folder in Finder" });
    }
  };

  const handleOpenInCodeMode = async () => {
    if (!selectedProjectId) return;
    try {
      await createConversationInProject(selectedProjectId);
      onOpenChange(false);
    } catch {
      notify({ tone: "error", title: "Could not open in Code mode" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] p-0 overflow-hidden bg-bg-surface border border-border-default rounded-2xl shadow-2xl">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 border border-accent/20 text-accent">
              <CodeIcon className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-text-primary">
                Export to Workspace Code
              </DialogTitle>
              <DialogDescription className="text-xs text-text-tertiary">
                Export &ldquo;{detail.site.title}&rdquo; directly into your active project
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {exportResult ? (
          /* Success Screen */
          <div className="p-6 flex flex-col items-center text-center space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 border border-success/30 text-success">
              <CheckCircledIcon className="h-7 w-7" />
            </div>

            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-text-primary">
                Design Successfully Exported!
              </h3>
              <p className="text-xs text-text-secondary max-w-[420px]">
                {exportResult.writtenFiles.length} files (
                {formatBytes(exportResult.totalBytes)}) were written to your project workspace.
              </p>
            </div>

            <div className="w-full text-left bg-bg-base border border-border-subtle rounded-xl p-3 font-mono text-2xs text-text-secondary break-all">
              {exportResult.destination}
            </div>

            {analysis && analysis.missingPackages.length > 0 && (
              <div className="w-full text-left bg-warning/10 border border-warning/20 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xs font-medium text-warning">
                    Remember to install missing packages:
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyInstall(analysis.installCommand)}
                    className="flex items-center gap-1 text-3xs font-mono text-text-primary hover:text-accent transition"
                  >
                    <CopyIcon className="h-3 w-3" />
                    <span>{copiedCmd ? "Copied!" : "Copy"}</span>
                  </button>
                </div>
                <div className="font-mono text-2xs text-text-primary bg-bg-surface px-2.5 py-1.5 rounded-md border border-border-subtle">
                  {analysis.installCommand}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2 w-full">
              <button
                type="button"
                onClick={() => void handleRevealInFinder()}
                className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl border border-border-default bg-bg-surface hover:bg-bg-hover text-xs font-medium text-text-primary transition"
              >
                <ExternalLinkIcon className="h-3.5 w-3.5 text-text-tertiary" />
                <span>Reveal in Finder</span>
              </button>

              <button
                type="button"
                onClick={() => void handleOpenInCodeMode()}
                className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl bg-accent text-accent-foreground hover:opacity-90 text-xs font-medium transition shadow-xs"
              >
                <ArrowRightIcon className="h-3.5 w-3.5" />
                <span>Open in Code Mode</span>
              </button>
            </div>
          </div>
        ) : (
          /* Configuration & Export Form */
          <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
            {/* 1. Target Project Selection */}
            <div className="space-y-2">
              <label className="text-2xs font-medium uppercase tracking-[var(--tracking-label)] text-text-faint">
                Target Project
              </label>
              {projects.length > 0 ? (
                <div className="relative">
                  <select
                    value={selectedProjectId ?? ""}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    className="w-full h-9 px-3 rounded-xl border border-border-default bg-bg-base text-xs text-text-primary focus:outline-hidden focus:ring-1 focus:ring-accent transition appearance-none cursor-pointer"
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.title} ({project.root})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="p-3 rounded-xl border border-dashed border-border-default bg-bg-base text-xs text-text-tertiary text-center">
                  No projects attached to Atlas. Attach a workspace project first in Code Mode.
                </div>
              )}
            </div>

            {/* 2. Destination Subpath */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-2xs font-medium uppercase tracking-[var(--tracking-label)] text-text-faint">
                  Export Subfolder
                </label>
                <div className="flex items-center gap-1 text-3xs text-text-tertiary">
                  <span>Presets:</span>
                  <button
                    type="button"
                    onClick={() => setSubpath(`src/components/design/${detail.site.slug}`)}
                    className="px-1.5 py-0.5 rounded bg-bg-base hover:bg-bg-hover hover:text-text-primary transition font-mono border border-border-subtle"
                  >
                    src/components
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubpath(`components/${detail.site.slug}`)}
                    className="px-1.5 py-0.5 rounded bg-bg-base hover:bg-bg-hover hover:text-text-primary transition font-mono border border-border-subtle"
                  >
                    components
                  </button>
                </div>
              </div>
              <div className="flex items-center rounded-xl border border-border-default bg-bg-base px-3 h-9 text-xs focus-within:ring-1 focus-within:ring-accent">
                <span className="text-text-tertiary font-mono mr-1 shrink-0 select-none">
                  {selectedProject ? `${selectedProject.title}/` : ""}
                </span>
                <input
                  type="text"
                  value={subpath}
                  onChange={(e) => setSubpath(e.target.value)}
                  placeholder="src/components/design/..."
                  className="flex-1 bg-transparent text-text-primary font-mono outline-hidden text-xs"
                />
              </div>
            </div>

            {/* 3. Automatic Package Detection */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-2xs font-medium uppercase tracking-[var(--tracking-label)] text-text-faint">
                  Package Dependencies
                </label>
                {isAnalyzing && (
                  <div className="flex items-center gap-1.5 text-3xs text-text-tertiary font-mono">
                    <ReloadIcon className="h-3 w-3 animate-spin" />
                    <span>Scanning package.json&hellip;</span>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border-subtle bg-bg-base/70 p-3 space-y-2.5">
                {analysis && analysis.detectedPackages.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.detectedPackages.map((pkg) => (
                        <div
                          key={pkg.name}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-2xs font-mono transition ${
                            pkg.installed
                              ? "bg-success/10 border-success/20 text-success"
                              : "bg-warning/10 border-warning/20 text-warning"
                          }`}
                        >
                          <span>{pkg.name}</span>
                          <span className="text-3xs opacity-80">
                            {pkg.installed ? `✓ ${pkg.version || "installed"}` : "missing"}
                          </span>
                        </div>
                      ))}
                    </div>

                    {analysis.missingPackages.length > 0 ? (
                      <div className="pt-2 border-t border-border-subtle space-y-1.5">
                        <div className="flex items-center justify-between text-2xs text-text-secondary">
                          <span>
                            Install missing packages via {analysis.packageManager}:
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleCopyInstall(analysis.installCommand)}
                            className="flex items-center gap-1 text-3xs font-mono text-accent hover:underline"
                          >
                            <CopyIcon className="h-3 w-3" />
                            <span>{copiedCmd ? "Copied!" : "Copy command"}</span>
                          </button>
                        </div>
                        <div className="font-mono text-2xs bg-bg-surface px-2.5 py-1.5 rounded-lg border border-border-subtle text-text-primary select-all">
                          {analysis.installCommand}
                        </div>
                      </div>
                    ) : (
                      <div className="text-2xs text-success flex items-center gap-1.5 pt-1">
                        <CheckCircledIcon className="h-3.5 w-3.5" />
                        <span>All detected dependencies are already installed in package.json.</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-text-tertiary flex items-center gap-2">
                    <FileTextIcon className="h-4 w-4 text-text-tertiary shrink-0" />
                    <span>Self-contained design. No external npm packages required.</span>
                  </div>
                )}
              </div>
            </div>

            {/* 4. Files Summary */}
            <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-bg-base border border-border-subtle text-2xs text-text-secondary">
              <span>{detail.files.length} design files ready to export</span>
              <span className="font-mono text-text-tertiary">
                {formatBytes(detail.files.reduce((acc, f) => acc + f.byteSize, 0))}
              </span>
            </div>
          </div>
        )}

        {!exportResult && (
          <DialogFooter className="px-6 py-4 border-t border-border-subtle bg-bg-base/40 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-3 py-1.5 rounded-xl border border-border-subtle bg-bg-surface hover:bg-bg-hover text-xs font-medium text-text-secondary hover:text-text-primary transition"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedProject || !subpath.trim() || isExporting}
              onClick={() => void handleExport()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-accent text-accent-foreground font-medium text-xs hover:opacity-90 transition disabled:opacity-50 shadow-xs"
            >
              {isExporting ? (
                <>
                  <ReloadIcon className="h-3.5 w-3.5 animate-spin" />
                  <span>Exporting&hellip;</span>
                </>
              ) : (
                <>
                  <CodeIcon className="h-3.5 w-3.5" />
                  <span>Export to Project</span>
                </>
              )}
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
