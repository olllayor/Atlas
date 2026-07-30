import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Laptop,
  Unlink,
} from 'lucide-react';
import { forwardRef } from 'react';

import type { WorkspaceMode, WorkspaceProject } from '../../../shared/contracts';
import { describeWorkspaceMode } from '../../../shared/workspaceModes';
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
        'flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-md font-medium transition-colors duration-150',
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
  mode,
  project,
  projects,
  disabled,
  onAttach,
  onSelect,
  onDetach,
  onReveal,
}: {
  mode: WorkspaceMode;
  project: WorkspaceProject | null;
  projects: WorkspaceProject[];
  disabled?: boolean;
  onAttach: () => void;
  onSelect: (projectId: string) => void;
  onDetach: () => void;
  onReveal: (projectId: string) => void;
}) {
  const needsProject = describeWorkspaceMode(mode).requiresProject && !project?.exists;
  const isMissing = project != null && !project.exists;

  return (
    <div className="pr-[6px]">
      <div className="px-5 lg:px-6">
        {/*
          A surface that tucks behind the composer rather than a free-floating
          toolbar. `pb-8` gives it a body; `-mb-8` pulls the composer up over
          all but ~8px of it, so what remains reads as one stacked object —
          a card peeking out from behind the slab, which is what the reference
          shows. Inset by `mx-2` so the composer's own edges stay outermost.

          `bg-bg-surface` sits between the page and the composer in the
          elevation scale, so the strip separates from the background without
          competing with the input.
        */}
        <div className="mx-auto max-w-content-max">
          <div className="-mb-8 mx-2 rounded-t-xl bg-bg-surface px-1 pb-8 pt-1">
            {/*
              `gap-1` on top of each chip's own `px-2`: ~20px between one label
              and the next icon. No dividers — the reference separates these
              with air, and a rule plus a surface is two separations doing one
              job.
            */}
            <div className="flex items-center gap-1">
              <ProjectMenu
                project={project}
                projects={projects}
                needsProject={needsProject}
                isMissing={isMissing}
                disabled={disabled}
                onAttach={onAttach}
                onSelect={onSelect}
                onDetach={onDetach}
                onReveal={onReveal}
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
                      <Laptop className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                      <span>Local</span>
                    </ContextChip>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Runs on this machine — reveal the folder
                  </TooltipContent>
                </Tooltip>
              ) : null}

              {project?.exists && project.branch ? <BranchChip branch={project.branch} /> : null}

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
    </div>
  );
}

/**
 * The branch, and a way to get it out of the app — the name is the thing you
 * paste into a `git checkout` or a PR description, and reading it off a chip
 * to retype it is the kind of small tax that adds up.
 */
function BranchChip({ branch }: { branch: string }) {
  const { copied, copy } = useClipboard();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ContextChip
          // The repository is the item allowed to lose characters when the
          // column narrows; the project and the runner are short by nature.
          className="max-w-48"
          aria-label={`Branch ${branch} — copy name`}
          onClick={() => void copy(branch)}
        >
          {copied ? (
            <ClipboardCheck
              className="size-4 shrink-0 text-success"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          ) : (
            <GitBranch className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          )}
          <span className="min-w-0 truncate">{branch}</span>
        </ContextChip>
      </TooltipTrigger>
      <TooltipContent side="top">
        {copied ? 'Copied' : 'Checked-out branch — click to copy'}
      </TooltipContent>
    </Tooltip>
  );
}

function ProjectMenu({
  project,
  projects,
  needsProject,
  isMissing,
  disabled,
  onAttach,
  onSelect,
  onDetach,
  onReveal,
}: {
  project: WorkspaceProject | null;
  projects: WorkspaceProject[];
  needsProject: boolean;
  isMissing: boolean;
  disabled?: boolean;
  onAttach: () => void;
  onSelect: (projectId: string) => void;
  onDetach: () => void;
  onReveal: (projectId: string) => void;
}) {
  const label = project ? project.title : needsProject ? 'Choose folder' : 'No folder';

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
                <Folder className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <FolderPlus className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
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
