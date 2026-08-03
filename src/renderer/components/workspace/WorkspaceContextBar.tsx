import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  Code2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Laptop,
  Unlink,
} from 'lucide-react';
import { forwardRef, useState } from 'react';

import type {
  AgentInstructionsSummary,
  GitBranchInfo,
  ProjectContextInfo,
  ProjectTypeInfo,
  WorkspaceMode,
  WorkspaceProject,
} from '../../../shared/contracts';
import { describeWorkspaceMode } from '../../../shared/workspaceModes';
import { notify, notifyError } from '../../lib/notify';
import { EnvironmentDialog } from './EnvironmentDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useClipboard } from '../../hooks/useClipboard';
import { cn } from '../../lib/utils';

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
 * It shares the composer's centred column (`max-w-content-max` plus the 6px
 * scrollbar rail) so the chips line up with the slab below them.
 */
export function WorkspaceContextBar({
  conversationId,
  mode,
  project,
  projects,
  projectContext,
  disabled,
  onAttach,
  onSelect,
  onDetach,
  onReveal,
  onProjectContextChanged,
}: {
  conversationId?: string;
  mode: WorkspaceMode;
  project: WorkspaceProject | null;
  projects: WorkspaceProject[];
  /** Detected type + configured env keys, from `workspace.context`. */
  projectContext?: ProjectContextInfo | null;
  disabled?: boolean;
  onAttach: () => void;
  onSelect: (projectId: string) => void;
  onDetach: () => void;
  onReveal: (projectId: string) => void;
  onProjectContextChanged?: () => void;
}) {
  const needsProject = describeWorkspaceMode(mode).requiresProject && !project?.exists;
  const isMissing = project != null && !project.exists;
  const projectType = projectContext?.projectType ?? null;
  const [environmentOpen, setEnvironmentOpen] = useState(false);

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
        <div className="mx-auto max-w-content-max">
          <div className="-mb-8 mx-5 rounded-t-2xl bg-bg-surface px-1.5 pb-8 pt-0.5">
            {/*
              `gap-0.5` on top of each chip's own `px-1.5`: ~14px between one
              label and the next icon. No dividers — the reference separates
              these with air, and a rule plus a surface is two separations
              doing one job.
            */}
            <div className="flex items-center gap-0.5">
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

              {/*
            Where the turn runs. Atlas has no cloud runner, so the word never
            changes — which is exactly why it is worth saying: in code mode the
            model edits the real files in that folder, on this machine, and the
            strip is the last thing you read before pressing send. Clicking it
            proves the claim by opening the folder.
          */}
              {project?.exists ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ContextChip
                      className="shrink-0"
                      aria-label="Runs on this machine — reveal the folder"
                      onClick={() => onReveal(project.id)}
                    >
                      <Laptop className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                      <span>Local</span>
                    </ContextChip>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Runs on this machine — reveal the folder
                  </TooltipContent>
                </Tooltip>
              ) : null}

              {project?.exists && project.branch ? (
                <BranchChip
                  branch={project.branch}
                  conversationId={conversationId}
                  onBranchChanged={onProjectContextChanged}
                />
              ) : null}

              {needsProject ? (
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
    </div>
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
        <div className="flex items-center justify-between px-2 py-1.5 text-xs font-semibold text-text-tertiary">
          <span>Git Branches</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void copy(branch);
            }}
            className="text-2xs text-text-faint hover:text-text-primary"
          >
            {copied ? 'Copied!' : 'Copy name'}
          </button>
        </div>
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
            className="flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 focus:bg-bg-hover"
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
          className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-text-secondary focus:bg-bg-hover focus:text-text-primary"
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
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-text-secondary focus:bg-bg-hover focus:text-text-primary"
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
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-text-secondary focus:bg-bg-hover focus:text-text-primary"
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
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-text-secondary focus:bg-bg-hover focus:text-text-primary"
            >
              <FolderOpen className="size-4 shrink-0" strokeWidth={1.75} />
              Reveal in file manager
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onDetach}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-text-secondary focus:bg-bg-hover focus:text-text-primary"
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
