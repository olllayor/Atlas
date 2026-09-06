/**
 * What the right panel can show, and when it can honestly show it.
 *
 * One table replaces the old `WORKBENCH_TABS` mode filter plus the ad-hoc
 * "hide Agents when the roster is empty" rule. The difference that matters is
 * that unavailability is now a *value with a reason*: a surface the current
 * conversation cannot open stays visible and says why, instead of vanishing
 * and reading as a missing feature.
 *
 * Two lengths of that reason, because they are read in different places:
 * `hint` sits in the picker card where the description would be, `reason`
 * fills the tooltip on a disabled menu row and can afford a full sentence.
 */

import {
  Bot,
  File,
  FileDiff,
  Files,
  GitBranch,
  Globe,
  ListTodo,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react';

import type { WorkspaceMode } from '../../../shared/contracts';
import type { RightPanelKind } from './rightPanelModel';

export type SurfaceAvailability =
  | { available: true }
  | { available: false; hint: string; reason: string };

const AVAILABLE: SurfaceAvailability = { available: true };

export type SurfaceContext = {
  conversationId?: string;
  mode: WorkspaceMode;
  /** A project folder is attached and still exists on disk. */
  hasProject: boolean;
  /** Subagents this conversation has spawned, live or settled. */
  agentCount: number;
  /** Live subagents (pending/running/waiting). Idle presents as settled. */
  liveAgentCount: number;
};

export type SurfaceDefinition = {
  kind: RightPanelKind;
  label: string;
  /** One line under the label in the picker. Says what the surface does. */
  description: string;
  /**
   * Single letter, uppercase. B, T, F and P stay reserved for Browser,
   * Terminal, Files and Pull request so the picker's muscle memory survives
   * those landing.
   */
  shortcut: string;
  icon: LucideIcon;
  /**
   * Whether the picker and the `+` menu offer it. A file surface is opened by
   * naming a file, so it has a definition (for its tab's icon) but nothing to
   * launch.
   */
  launcher: boolean;
  availability: (context: SurfaceContext) => SurfaceAvailability;
};

/**
 * Surfaces that read the workspace need one. Diff and Git additionally need
 * the folder to be a git repository, but their own panels say so with the
 * detail this two-line hint cannot carry.
 */
function projectAvailability(context: SurfaceContext): SurfaceAvailability {
  if (context.mode !== 'code') {
    return {
      available: false,
      hint: 'Only in Code mode.',
      reason: 'Work mode has no project folder to read. Switch this conversation to Code mode.',
    };
  }
  if (!context.hasProject) {
    return {
      available: false,
      hint: 'No project attached.',
      reason: 'Attach a project folder to this conversation to read its files.',
    };
  }
  return AVAILABLE;
}

export const SURFACE_DEFINITIONS = [
  {
    kind: 'diff',
    label: 'Diff',
    description: 'Review changes in this thread.',
    shortcut: 'D',
    icon: FileDiff,
    launcher: true,
    availability: projectAvailability,
  },
  {
    kind: 'git',
    label: 'Git',
    description: 'Branch, working tree, and history.',
    shortcut: 'G',
    icon: GitBranch,
    launcher: true,
    availability: projectAvailability,
  },
  {
    kind: 'tasks',
    label: 'Tasks',
    description: 'Every tool call, with its status.',
    // K rather than T: Terminal takes T when it lands.
    shortcut: 'K',
    icon: ListTodo,
    launcher: true,
    availability: (context) =>
      context.conversationId
        ? AVAILABLE
        : {
            available: false,
            hint: 'No conversation open.',
            reason: 'Open a conversation to follow its tool calls.',
          },
  },
  {
    kind: 'terminal',
    label: 'Terminal',
    description: 'Start a shell in this workspace.',
    shortcut: 'T',
    icon: TerminalSquare,
    launcher: true,
    // A shell with no project falls back to the home directory, which is
    // still a usable shell — there is nothing to withhold here.
    availability: (context) =>
      context.conversationId
        ? AVAILABLE
        : {
            available: false,
            hint: 'No conversation open.',
            reason: 'Open a conversation to start a shell beside it.',
          },
  },
  {
    kind: 'browser',
    label: 'Browser',
    description: 'Open a local app or URL.',
    shortcut: 'B',
    icon: Globe,
    launcher: true,
    // A browser tab needs nothing from the workspace: the point is often to
    // look at a server the conversation has not been told about yet.
    availability: (context) =>
      context.conversationId
        ? AVAILABLE
        : {
            available: false,
            hint: 'No conversation open.',
            reason: 'Open a conversation to browse beside it.',
          },
  },
  {
    kind: 'files',
    label: 'Files',
    description: 'Browse and read workspace files.',
    shortcut: 'F',
    icon: Files,
    launcher: true,
    availability: projectAvailability,
  },
  {
    kind: 'file',
    label: 'File',
    description: 'One file, read-only.',
    // Never offered by the picker, so it needs no letter of its own.
    shortcut: '',
    icon: File,
    launcher: false,
    availability: projectAvailability,
  },
  {
    kind: 'agents',
    label: 'Agents',
    description: 'Follow subagents and workflows.',
    shortcut: 'A',
    icon: Bot,
    launcher: true,
    availability: (context) =>
      context.agentCount > 0
        ? AVAILABLE
        : {
            available: false,
            hint: 'No subagents in this thread yet.',
            reason: 'This thread has not spawned a subagent yet.',
          },
  },
] as const satisfies readonly SurfaceDefinition[];

const DEFINITIONS_BY_KIND = new Map<RightPanelKind, SurfaceDefinition>(
  SURFACE_DEFINITIONS.map((definition) => [definition.kind, definition])
);

export function surfaceDefinition(kind: RightPanelKind): SurfaceDefinition | undefined {
  return DEFINITIONS_BY_KIND.get(kind);
}

export function surfaceLabel(kind: RightPanelKind): string {
  return DEFINITIONS_BY_KIND.get(kind)?.label ?? kind;
}
