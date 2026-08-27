import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  Cloud,
  Code2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitFork,
  GitPullRequest,
  Laptop,
  RotateCcw,
  Unlink,
} from 'lucide-react';
import { forwardRef, useEffect, useMemo, useState } from 'react';

import type {
  AgentInstructionsSummary,
  GitBranchInfo,
  GitHubPrInfo,
  ProjectContextInfo,
  ProjectTypeInfo,
  WorkspaceMode,
  WorkspaceProject,
} from '../../../shared/contracts';
import { describeWorkspaceMode, type ExecutionTarget } from '../../../shared/workspaceModes';
import { notify, notifyError } from '../../lib/notify';
import { ConfirmDialog } from '../providers/ConfirmDialog';
import { EnvironmentDialog } from './EnvironmentDialog';
import { PluginToolsChip } from './PluginToolsChip';
import { JobsChip } from './JobsChip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useClipboard } from '../../hooks/useClipboard';
import { cn } from '../../lib/utils';
import {
  executionTargetChipText,
  executionTargetRows,
  revealTargetForChip,
  worktreeBranchShort,
} from './executionTargetViewModel';

/**
 * One chip in the strip. Every item is a real button with the same geometry
 * and the same hover, because they used to *look* identical while only the
 * project one did anything — an inert span wearing a control's clothes.
 *
 * Sizing rides the tokens (`text-md` is derived from the UI font size, so the
 * strip scales with the Settings slider) rather than fixed pixels.
 */
const ContextChip = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: 'default' | 'warning';
  }
>(function ContextChip({ className, tone = 'default', ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'flex h-6 min-w-0 items-center gap-1 rounded-md px-1.5 text-sm font-medium transition-colors duration-150',
        'outline-none focus-visible:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50',
        // Near-white at rest, not tertiary: in the reference these labels are
        // among the brightest things on screen, brighter than the composer's
        // own placeholder underneath them.
        tone === 'warning'
          ? 'text-warning-text hover:bg-bg-hover'
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        className,
      )}
      {...props}
    />
  );
});

/**
 * The strip directly above the composer: what folder this turn will run in and
 * which branch it is on.
 *
 * Codex puts this context immediately above the input rather than in the title
 * bar, and it is the right call — this is a property of the message you are
 * about to send, so it belongs where you are looking when you send it. The
 * mode switch stays in the title bar because it describes the conversation,
 * not the turn.
 *
 * It shares the composer's centred column (`max-w-composer`, the 48rem
 * composer measure, plus the 6px
 * scrollbar rail) so the chips line up with the slab below them.
 */
export function WorkspaceContextBar({
  mode,
  executionTarget = 'local',
  project,
  projects = [],
  worktreeRoot,
  conversationId,
  projectContext,
  disabled,
  cloudSandboxEnabled = false,
  minimal = false,
  onAttach,
  onSelect,
  onDetach,
  onReveal,
  onRevealTarget,
  onOpenSettings,
  onExecutionTargetChange,
  onWorktreeFromBranch,
  onRemoveWorktree,
  onProjectContextChanged,
}: {
  mode: WorkspaceMode;
  executionTarget?: ExecutionTarget;
  project: WorkspaceProject | null;
  projects?: WorkspaceProject[];
  worktreeRoot?: string | null;
  conversationId?: string;
  projectContext?: ProjectContextInfo | null;
  disabled?: boolean;
  /** Settings → Beta. Gates both the cloud row and, less obviously, selecting
      local while the conversation currently runs in the cloud. */
  cloudSandboxEnabled?: boolean;
  /**
   * Post-first-message form: the pre-flight chrome — project, execution
   * target, branch, PR — is for aiming the *first* message and goes away once
   * there is history to read; only the event-driven chips (plugin tools,
   * background jobs) survive, because they surface states the user otherwise
   * cannot see. The mode menu in the sidebar carries the execution target
   * from here on.
   */
  minimal?: boolean;
  onAttach: () => void;
  onSelect: (projectId: string) => void;
  onDetach: () => void;
  onReveal: (projectId: string) => void;
  /** Reveals the conversation's project or worktree root, resolved safely in main. */
  onRevealTarget?: (target: 'project' | 'worktree') => void;
  /** Opens Settings → Beta so cloud can be enabled. */
  onOpenSettings?: () => void;
  onExecutionTargetChange?: (target: ExecutionTarget) => void;
  /** Starts a fresh worktree for this conversation from a chosen branch. */
  onWorktreeFromBranch?: (branch: string) => void;
  /** Deletes the conversation's worktree on disk; the target then reads local. */
  onRemoveWorktree?: () => void;
  onProjectContextChanged?: () => void;
}) {
  const needsProject = describeWorkspaceMode(mode).requiresProject && !project?.exists;
  const isMissing = project != null && !project.exists;
  const projectType = projectContext?.projectType ?? null;
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

  const confirmRemoveWorktree = () => {
    setRemoveConfirmOpen(false);
    onRemoveWorktree?.();
  };

  return (
    <div className="pr-[6px]">
      <div className="px-5 lg:px-6">
        {/*
          A surface that tucks behind the composer rather than a free-floating
          toolbar. `pb-8` gives it a body; `-mb-8` pulls the composer up over
          all but ~8px of it, so what remains reads as one stacked object —
          a card peeking out from behind the slab, which is what the reference
          shows. Inset by `mx-5` so the composer's own edges stay outermost,
          and rounded harder than the chips inside it so the peek reads as a
          tab rather than a toolbar.

          `bg-bg-surface` sits between the page and the composer in the
          elevation scale, so the strip separates from the background without
          competing with the input.
        */}
        <div className="mx-auto max-w-composer">
          <div
          className={cn(
            '-mb-8 mx-5 px-1.5 pb-8 pt-0.5',
            // The tab surface is the pre-flight look — a card peeking out
            // from behind the slab. Minimal form is a quiet chip row with
            // no card: there is nothing to tab into anymore.
            !minimal && 'rounded-t-2xl bg-bg-surface'
          )}
        >
            {/*
              `gap-0.5` on top of each chip's own `px-1.5`: ~14px between one
              label and the next icon. No dividers — the reference separates
              these with air, and a rule plus a surface is two separations
              doing one job.
            */}
            <div className="flex items-center gap-0.5">
              {!minimal ? (
                <ProjectMenu
                  conversationId={conversationId}
                  project={project}
                  projects={projects}
                  projectType={projectType}
                  envCount={projectContext?.envKeys.length ?? 0}
                  agentInstructions={projectContext?.agentInstructions ?? null}
                  needsProject={needsProject}
                  isMissing={isMissing}
                  disabled={disabled}
                  onAttach={onAttach}
                  onSelect={onSelect}
                  onDetach={onDetach}
                  onReveal={onReveal}
                  onOpenEnvironment={() => setEnvironmentOpen(true)}
                  onInstructionsChanged={onProjectContextChanged}
                />
              ) : null}

              {/*
            Where the turn runs — and, unlike its neighbours, also where the
            next turn *will*. This is the one chip that is a picker, not just a
            readout: the choice moves in step with project and branch, all three
            keyed off the conversation. The admission rules (git for worktree,
            the beta flag for cloud) come from the view model, not the JSX.
          */}
              {!minimal && project?.exists && onExecutionTargetChange ? (
                <ExecutionTargetChip
                  conversationId={conversationId}
                  executionTarget={executionTarget}
                  worktreeLabel={worktreeBranchShort(conversationId)}
                  isGitRepo={Boolean(project.isGitRepository)}
                  cloudSandboxEnabled={cloudSandboxEnabled}
                  hasWorktree={Boolean(worktreeRoot)}
                  onSelect={onExecutionTargetChange}
                  onSelectWorktreeFromBranch={
                    onWorktreeFromBranch
                      ? (branch) => onWorktreeFromBranch(branch)
                      : undefined
                  }
                  onReveal={onRevealTarget}
                  onOpenSettings={onOpenSettings}
                  onRemoveWorktree={() => setRemoveConfirmOpen(true)}
                />
              ) : null}

              {!minimal && project?.exists && project.branch ? (
                <BranchChip
                  branch={project.branch}
                  conversationId={conversationId}
                  onBranchChanged={onProjectContextChanged}
                />
              ) : null}

              {!minimal && project?.exists ? <PullRequestChip conversationId={conversationId} /> : null}

              {/* Renders nothing unless an installed plugin carries tools, so a
                  user with no plugins sees no extra chrome. */}
              <PluginToolsChip conversationId={conversationId} />

              {/* Renders nothing unless the conversation owns background jobs. */}
              <JobsChip conversationId={conversationId} />

              {!minimal && needsProject ? (
                <span className="flex min-w-0 items-center gap-1.5 text-2xs text-text-faint">
                  <AlertTriangle
                    className="size-3 shrink-0 text-warning-text"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate">
                    {isMissing
                      ? 'Folder is gone — editing tools are off'
                      : 'Code mode needs a folder — editing tools are off'}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {project?.exists && projectContext ? (
        <EnvironmentDialog
          open={environmentOpen}
          onOpenChange={setEnvironmentOpen}
          project={project}
          context={projectContext}
          branch={project.branch}
          onReveal={onReveal}
          onEnvChanged={() => onProjectContextChanged?.()}
        />
      ) : null}

      {onRemoveWorktree ? (
        <ConfirmDialog
          open={removeConfirmOpen}
          tone="danger"
          title="Remove worktree?"
          description={
            <span>
              Deletes the isolated git worktree for this conversation from disk
              and returns it to running locally. If the worktree holds
              uncommitted changes, git will refuse and nothing is removed.
            </span>
          }
          confirmLabel="Remove worktree"
          cancelLabel="Cancel"
          onConfirm={confirmRemoveWorktree}
          onCancel={() => setRemoveConfirmOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ExecutionTargetChip({
  conversationId,
  executionTarget,
  worktreeLabel,
  isGitRepo,
  cloudSandboxEnabled,
  hasWorktree,
  disabled,
  onSelect,
  onSelectWorktreeFromBranch,
  onReveal,
  onOpenSettings,
  onRemoveWorktree,
}: {
  conversationId?: string;
  executionTarget: ExecutionTarget;
  worktreeLabel: string | null;
  isGitRepo: boolean;
  cloudSandboxEnabled: boolean;
  hasWorktree: boolean;
  disabled?: boolean;
  onSelect: (target: ExecutionTarget) => void;
  /** Starts a fresh worktree from a chosen branch (Codex's "from develop"). */
  onSelectWorktreeFromBranch?: (branch: string) => void;
  onReveal?: (target: 'project' | 'worktree') => void;
  onOpenSettings?: () => void;
  /** Opens the destructive-removal confirmation; removal itself lives in App. */
  onRemoveWorktree?: () => void;
}) {
  const copy = executionTargetChipText({ target: executionTarget, worktreeBranch: worktreeLabel });
  const rows = executionTargetRows({ isGitRepo, cloudSandboxEnabled });
  // A conversation on Worktree reveals its worktree root; anything else (local,
  // cloud, or a worktree label without an actual root) reveals the project root.
  const revealTarget = revealTargetForChip({ executionTarget, hasWorktree });
  /** Local branches for the "new worktree from…" section, loaded when the menu first opens. */
  const [baseBranches, setBaseBranches] = useState<GitBranchInfo[] | null>(null);

  useEffect(() => {
    if (!isGitRepo || !conversationId || baseBranches) return;
    let cancelled = false;
    void window.atlasChat.git
      .getBranches(conversationId)
      .then((branches) => {
        if (!cancelled) setBaseBranches(branches);
      })
      .catch(() => {
        // A menu without the branch section still picks Local and Cloud.
      });
    return () => {
      cancelled = true;
    };
  }, [baseBranches, conversationId, isGitRepo]);

  /**
   * Candidate bases: local branches only (a remote-tracking name creates a
   * worktree detached from anything pushable), Atlas's own managed/snapshot
   * branches excluded — branching an agent scratch space off another agent
   * scratch space is never what "from develop" meant. Current branch first.
   */
  const baseBranchChoices = useMemo(() => {
    if (!baseBranches) return [];
    return baseBranches
      .filter((branch) => !branch.remote && !branch.name.startsWith('atlas/'))
      .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name))
      .slice(0, 6);
  }, [baseBranches]);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <ContextChip className="max-w-64 shrink-0" aria-label={copy.aria}>
              {executionTarget === 'cloud' ? (
                <Cloud className="size-3.5 shrink-0 text-brand" strokeWidth={1.75} aria-hidden="true" />
              ) : executionTarget === 'worktree' ? (
                <GitFork className="size-3.5 shrink-0 text-brand" strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Laptop className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              )}
              <span className="min-w-0 truncate">{copy.label}</span>
            </ContextChip>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{copy.tooltip}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" side="top" sideOffset={6} className="w-[280px]">
        <DropdownMenuLabel className="px-2.5 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wide text-text-muted">
          Execution target
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-label="Execution target"
          value={executionTarget}
          onValueChange={(value) => onSelect(value as ExecutionTarget)}
        >
          {rows.map((row) =>
            row.needsSettings ? (
              <DropdownMenuItem
                key={row.value}
                onSelect={() => onOpenSettings?.()}
                disabled={!onOpenSettings}
                className="items-start rounded-md px-2.5 py-2 opacity-60"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-text-primary">{row.label}</span>
                  <span className="text-2xs leading-4 text-text-tertiary">{row.tagline}</span>
                </span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuRadioItem
                key={row.value}
                value={row.value}
                disabled={row.disabled}
                className="items-start rounded-md py-2 pr-3"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-text-primary">{row.label}</span>
                  <span className="text-2xs leading-4 text-text-tertiary">{row.tagline}</span>
                </span>
              </DropdownMenuRadioItem>
            ),
          )}
        </DropdownMenuRadioGroup>

        {executionTarget !== 'worktree' && onSelectWorktreeFromBranch && baseBranchChoices.length > 0 ? (
          <>
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuLabel className="px-2.5 pb-1 pt-1 text-2xs font-medium uppercase tracking-wide text-text-muted">
              New worktree from branch
            </DropdownMenuLabel>
            {baseBranchChoices.map((branch) => (
              <DropdownMenuItem
                key={branch.name}
                onSelect={() => onSelectWorktreeFromBranch(branch.name)}
                className="items-center gap-2 rounded-md px-2.5 py-1.5"
              >
                {branch.current ? (
                  <GitBranch className="size-3.5 shrink-0 text-brand" strokeWidth={1.75} aria-hidden />
                ) : (
                  <GitFork className="size-3.5 shrink-0 text-text-faint" strokeWidth={1.75} aria-hidden />
                )}
                <span className="min-w-0 truncate text-sm text-text-secondary">{branch.name}</span>
                {branch.current ? (
                  <span className="ml-auto shrink-0 text-2xs text-text-faint">current</span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}

        {executionTarget === 'cloud' ? (
          <>
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuItem
              onSelect={async () => {
                try {
                  const res = await window.atlasChat?.conversations?.resetCloudSandbox?.(conversationId ?? '');
                  if (res?.success) {
                    notify({ tone: 'success', title: 'Cloud sandbox reset', description: 'Session isolate state cleared.' });
                  } else {
                    notify({ tone: 'error', title: 'Reset failed', description: res?.error || 'Could not reset session.' });
                  }
                } catch (err: any) {
                  notify({ tone: 'error', title: 'Reset failed', description: err.message || String(err) });
                }
              }}
              className="gap-2 px-2.5 py-2 text-sm"
            >
              <RotateCcw className="size-4 shrink-0" strokeWidth={1.75} />
              Reset cloud session
            </DropdownMenuItem>
          </>
        ) : null}

        {(executionTarget !== 'cloud' || hasWorktree) && onReveal ? (
          <>
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuItem
              onSelect={() => onReveal(revealTarget)}
              className="gap-2 px-2.5 py-2 text-sm"
            >
              <FolderOpen className="size-4 shrink-0" strokeWidth={1.75} />
              Reveal in file manager
            </DropdownMenuItem>
            {hasWorktree && onRemoveWorktree ? (
              <DropdownMenuItem onSelect={onRemoveWorktree} className="gap-2 px-2.5 py-2 text-sm">
                <Unlink className="size-4 shrink-0" strokeWidth={1.75} />
                Remove worktree…
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The open pull request for this branch, when there is one.
 *
 * Shows nothing at all otherwise — including when `gh` is missing or signed
 * out. A chip that exists only to say a feature is unavailable is noise on a
 * strip this dense; the model reports those states through `github_pr_status`
 * when the user actually asks for a pull request.
 *
 * Creating one deliberately does not live here: it goes through the agent tool,
 * so every pull request this app opens passes the same approval prompt and
 * lands in the transcript.
 */
function PullRequestChip({ conversationId }: { conversationId?: string }) {
  const [pr, setPr] = useState<GitHubPrInfo | null>(null);

  useEffect(() => {
    if (!conversationId || !window.atlasChat?.github?.getPrStatus) {
      setPr(null);
      return;
    }

    let cancelled = false;

    void window.atlasChat.github
      .getPrStatus(conversationId)
      .then((status) => {
        if (!cancelled) {
          setPr(status.pr);
        }
      })
      .catch(() => {
        // A repository without GitHub configured is the common case, not a
        // fault worth surfacing on the strip.
        if (!cancelled) {
          setPr(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  if (!pr) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ContextChip
          className="max-w-48"
          aria-label={`Pull request #${pr.number} — open on GitHub`}
          onClick={() => void window.atlasChat.github.openPr(pr.url).catch(() => undefined)}
        >
          <GitPullRequest className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span className="min-w-0 truncate">
            #{pr.number}
            {pr.isDraft ? ' (draft)' : ''}
          </span>
        </ContextChip>
      </TooltipTrigger>
      <TooltipContent side="top">
        {pr.title} → {pr.baseRefName}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The branch chip — opens a dropdown with all local/remote git branches
 * and allows quick copy or branch switching.
 */
function BranchChip({
  branch,
  conversationId,
  onBranchChanged,
}: {
  branch: string;
  conversationId?: string;
  onBranchChanged?: () => void;
}) {
  const { copied, copy } = useClipboard();
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);

  const fetchBranches = async () => {
    if (!conversationId || !window.atlasChat?.git?.getBranches) return;
    setLoading(true);
    try {
      const list = await window.atlasChat.git.getBranches(conversationId);
      setBranches(list);
    } catch (err) {
      console.warn('Failed to load branches:', err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Checking out moves the files the conversation is about, so the failure
   * path matters more than the happy one: git refuses a switch that would
   * discard local changes, and that refusal is what the user needs to read.
   */
  const switchTo = async (name: string) => {
    if (!conversationId || switching) return;
    setSwitching(true);
    try {
      const state = await window.atlasChat.git.switchBranch(conversationId, name);
      notify({ tone: 'success', title: `Switched to ${state.branch ?? name}` });
      onBranchChanged?.();
    } catch (err) {
      notifyError('Could not switch branch', err);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) void fetchBranches(); }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <ContextChip
              className="max-w-48"
              aria-label={`Branch ${branch} — click to switch branches`}
            >
              {copied ? (
                <ClipboardCheck
                  className="size-3.5 shrink-0 text-success"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              ) : (
                <GitBranch className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              )}
              <span className="min-w-0 truncate">{branch}</span>
            </ContextChip>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          Current branch: {branch} (click to switch)
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" className="w-56">
        {/* Same section-header grammar as the execution-target menu beside
            it — a raw div here was the one strip menu that drifted. */}
        <DropdownMenuLabel className="flex items-center justify-between gap-2 px-2.5 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wide text-text-muted">
          <span className="min-w-0 truncate">Git branches</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void copy(branch);
            }}
            className="shrink-0 cursor-pointer rounded-sm text-2xs normal-case tracking-normal text-text-faint transition-colors hover:text-text-primary"
          >
            {copied ? 'Copied!' : 'Copy name'}
          </button>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {branches.length > 0 ? (
          branches.map((b) => {
            const isCurrent = b.current || b.name === branch;

            return (
              <DropdownMenuItem
                key={b.name}
                disabled={isCurrent || switching}
                onSelect={() => void switchTo(b.name)}
                className="flex items-center justify-between text-xs"
              >
                <span className={cn('truncate', isCurrent && 'font-medium text-text-primary')}>
                  {b.name} {b.remote ? '(remote)' : ''}
                </span>
                {isCurrent ? <Check className="size-3.5 text-success" /> : null}
              </DropdownMenuItem>
            );
          })
        ) : (
          <DropdownMenuItem disabled className="text-xs text-text-faint">
            {loading ? 'Loading branches...' : branch}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectMenu({
  conversationId,
  project,
  projects,
  projectType,
  envCount,
  agentInstructions,
  needsProject,
  isMissing,
  disabled,
  onAttach,
  onSelect,
  onDetach,
  onReveal,
  onOpenEnvironment,
  onInstructionsChanged,
}: {
  conversationId?: string;
  project: WorkspaceProject | null;
  projects: WorkspaceProject[];
  projectType: ProjectTypeInfo | null;
  envCount: number;
  /** Which AGENTS.md files the main process loaded for this turn, if any. */
  agentInstructions: AgentInstructionsSummary | null;
  needsProject: boolean;
  isMissing: boolean;
  disabled?: boolean;
  onAttach: () => void;
  onSelect: (projectId: string) => void;
  onDetach: () => void;
  onReveal: (projectId: string) => void;
  onOpenEnvironment: () => void;
  onInstructionsChanged?: () => void;
}) {
  const label = project ? project.title : needsProject ? 'Choose folder' : 'No folder';
  // A global-scope file is loaded but belongs to no project, so it does not
  // count as this folder having instructions: the slot offers to create one.
  const projectInstructions = agentInstructions?.sources.find((source) => source.scope === 'project') ?? null;

  const openInstructions = async () => {
    if (!conversationId || !projectInstructions) return;
    try {
      await window.atlasChat.workspace.openInstructions(conversationId, projectInstructions.path);
    } catch (err) {
      notifyError('Could not open AGENTS.md', err);
    }
  };

  const createInstructions = async () => {
    if (!conversationId) return;
    try {
      await window.atlasChat.workspace.initInstructions(conversationId);
      onInstructionsChanged?.();
    } catch (err) {
      notifyError('Could not create AGENTS.md', err);
    }
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <ContextChip
              aria-label="Project folder"
              tone={needsProject || isMissing ? 'warning' : 'default'}
              className="max-w-56"
            >
              {project ? (
                <Folder className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <FolderPlus className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              )}
              <span className="min-w-0 truncate">{label}</span>
            </ContextChip>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {project
            ? isMissing
              ? `${project.root} is no longer on disk`
              : project.root
            : 'Attach a folder to give this conversation a working directory'}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="w-[300px] rounded-lg border border-border-default bg-bg-overlay p-1 shadow-none"
      >
        {projects.map((entry) => (
          <DropdownMenuItem
            key={entry.id}
            onSelect={() => onSelect(entry.id)}
            className="flex cursor-pointer items-start gap-2 px-2.5 py-2"
          >
            <span className="mt-0.5 w-3.5 shrink-0">
              {entry.id === project?.id ? <Check className="size-3.5 text-text-secondary" /> : null}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className={cn(
                    'truncate text-sm leading-5',
                    entry.exists ? 'text-text-primary' : 'text-warning-text',
                  )}
                >
                  {entry.title}
                </span>
                {entry.branch ? (
                  <span className="shrink-0 text-2xs text-text-faint">{entry.branch}</span>
                ) : null}
              </span>
              {/* The path is the identity — two checkouts of one repo share a title. */}
              <span className="truncate text-2xs leading-4 text-text-tertiary" dir="rtl">
                {entry.exists ? entry.root : `Missing — ${entry.root}`}
              </span>
            </span>
          </DropdownMenuItem>
        ))}

        {projects.length > 0 ? <DropdownMenuSeparator className="my-1 bg-border-default" /> : null}

        <DropdownMenuItem
          onSelect={onAttach}
          className="flex cursor-pointer items-center gap-2 px-2.5 py-2 text-sm"
        >
          <FolderPlus className="size-4 shrink-0" strokeWidth={1.75} />
          Choose folder…
        </DropdownMenuItem>

        {project ? (
          <>
            {/*
              Detected stack and configured variables belong to the folder, so
              they live in the folder's menu rather than as another chip in the
              strip: neither changes what a send does, and the reference bar
              carries only things that do.
            */}
            {/*
              The instructions the model is actually being given, one click from
              the folder they belong to. Nothing here loads the text into the
              renderer — the file opens in the user's editor, which is where it
              would be edited anyway.
            */}
            <DropdownMenuItem
              onSelect={() => void (projectInstructions ? openInstructions() : createInstructions())}
              disabled={!project.exists}
              className="flex cursor-pointer items-center gap-2 px-2.5 py-2 text-sm"
            >
              <FileText className="size-4 shrink-0" strokeWidth={1.75} />
              {projectInstructions ? 'AGENTS.md' : 'Create AGENTS.md'}
              {projectInstructions && agentInstructions ? (
                <span className="ml-auto shrink-0 text-2xs text-text-faint">
                  {agentInstructions.truncated
                    ? 'truncated'
                    : agentInstructions.sources.length > 1
                      ? `${agentInstructions.sources.length} files`
                      : 'loaded'}
                </span>
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onOpenEnvironment}
              disabled={!project.exists}
              className="flex cursor-pointer items-center gap-2 px-2.5 py-2 text-sm"
            >
              <Code2 className="size-4 shrink-0" strokeWidth={1.75} />
              Environment
              <span className="ml-auto shrink-0 text-2xs text-text-faint">
                {[
                  projectType && projectType.type !== 'unknown'
                    ? [projectType.type, projectType.packageManager].filter(Boolean).join(' · ')
                    : null,
                  envCount > 0 ? `${envCount} var${envCount === 1 ? '' : 's'}` : null,
                ]
                  .filter(Boolean)
                  .join('  ')}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onReveal(project.id)}
              disabled={!project.exists}
              className="flex cursor-pointer items-center gap-2 px-2.5 py-2 text-sm"
            >
              <FolderOpen className="size-4 shrink-0" strokeWidth={1.75} />
              Reveal in file manager
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onDetach}
              className="flex cursor-pointer items-center gap-2 px-2.5 py-2 text-sm"
            >
              <Unlink className="size-4 shrink-0" strokeWidth={1.75} />
              Detach from this conversation
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
