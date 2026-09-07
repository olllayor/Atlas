import {
  ANTIGRAVITY_CHAT_DEFAULT_MODEL,
  ANTIGRAVITY_DEFAULT_MODEL
} from '../../../shared/antigravityModels.js';

export interface ProviderAuthStatus {
  status: 'unknown' | 'authenticated' | 'unauthenticated' | string;
}

export interface ProviderModelRef {
  id: string;
  name?: string;
  label?: string;
}

export interface ServerProvider {
  driver?: string;
  instanceId?: string;
  installed?: boolean;
  status: 'ready' | 'warning' | 'error' | 'disabled' | string;
  auth: ProviderAuthStatus;
  models: ProviderModelRef[];
  message?: string | null;
}

export type MessageId = string;
export type TurnId = string;

export interface TimelineWorkItem {
  id: string;
  createdAt?: number | string | Date;
  turnId?: TurnId;
  label?: string;
  tone?: 'tool' | 'thinking' | 'error' | string;
  command?: string;
  itemType?: string;
  requestKind?: string;
  toolCallId?: string;
  toolLifecycleStatus?: string;
  [key: string]: unknown;
}

export interface TimelineWorkEntry {
  id: string;
  kind: 'work';
  createdAt?: number | string | Date;
  entry: TimelineWorkItem;
  [key: string]: unknown;
}

export interface TimelineMessageEntry {
  id: string;
  kind: 'message' | string;
  createdAt?: number | string | Date;
  message?: {
    id: MessageId;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type TimelineEntry =
  | TimelineWorkEntry
  | TimelineMessageEntry
  | {
      id: string;
      kind: string;
      entry?: any;
      [key: string]: unknown;
    };

/**
 * Returns a human-readable reason if Antigravity should block sending, or null if send is allowed.
 *
 * After a restart, Antigravity often reports auth as unknown and an empty model catalog
 * even when saved Google credentials are valid. We allow session startup to check the saved
 * credentials and validate the chosen model rather than blocking sending.
 */
export function getAntigravitySendBlockReason(
  provider: Pick<ServerProvider, 'installed' | 'auth' | 'models'> & { status?: string },
  model: string
): string | null {
  if (!provider.installed) {
    return 'Install Antigravity in provider settings before sending.';
  }
  if (provider.auth.status === 'unauthenticated') {
    return 'Sign in to Antigravity in provider settings before sending.';
  }
  const slug = model.trim();
  if (slug.length === 0) return 'Choose an Antigravity model before sending.';
  // A restart clears the account status and catalog. Session startup checks
  // saved credentials and validates the model before sending the prompt.
  if (provider.auth.status === 'unknown') return null;
  if (provider.models.length === 0) {
    return 'Refresh Antigravity models in provider settings before sending.';
  }
  // A saved model that left the catalog is kept in the picker as unavailable
  // so the user sees what the thread used. The server rejects it at turn
  // start, so block here unless the provider is in an error state, where a
  // refresh might bring it back.
  if (!provider.models.some((m) => m.id === slug) && provider.status !== 'error') {
    return `Model "${slug}" is not available. Choose another model before sending.`;
  }
  return null;
}

/**
 * Determines whether a scroll anchor locking a turn or message should be released
 * because tool work (commands, file operations, tool calls) has begun in the active turn.
 *
 * Prevents threads with active tool activity from opening or remaining on a full page of
 * blank space above expanding tool output, while preserving the user's reading position
 * when they have scrolled up into history.
 * Ported from t3code PR #7971.
 */
export function shouldReleaseTimelineAnchorForToolActivity(input: {
  anchorMessageId: MessageId | null;
  liveFollowEnabled: boolean;
  runningTurnId: TurnId | null;
  timelineEntries: ReadonlyArray<TimelineEntry>;
}): boolean {
  if (input.anchorMessageId === null || !input.liveFollowEnabled || input.runningTurnId === null) {
    return false;
  }

  return input.timelineEntries.some((timelineEntry) => {
    if (
      timelineEntry.kind !== 'work' ||
      !timelineEntry.entry ||
      timelineEntry.entry.turnId !== input.runningTurnId
    ) {
      return false;
    }

    const entry = timelineEntry.entry;
    return (
      entry.tone === 'tool' ||
      entry.itemType !== undefined ||
      entry.requestKind !== undefined ||
      (entry.command?.trim().length ?? 0) > 0
    );
  });
}

/**
 * Converts Atlas chat message parts into TimelineEntry items for anchor release checks.
 */
export function chatPartsToTimelineEntries(
  turnId: TurnId,
  parts: ReadonlyArray<any>
): TimelineEntry[] {
  return parts.map((part, index) => {
    if (part.type === 'tool') {
      const command =
        typeof part.args === 'object' && part.args && 'command' in part.args
          ? String((part.args as { command: unknown }).command)
          : undefined;
      return {
        id: part.toolCallId || `tool-${index}`,
        kind: 'work' as const,
        entry: {
          id: part.toolCallId || `tool-${index}`,
          turnId,
          label: part.toolName || 'Run command',
          tone: 'tool' as const,
          command,
          toolCallId: part.toolCallId,
          itemType: part.toolType ?? 'tool_execution',
          toolLifecycleStatus: part.state
        }
      };
    }
    if (part.type === 'reasoning') {
      return {
        id: `reasoning-${index}`,
        kind: 'work' as const,
        entry: {
          id: `reasoning-${index}`,
          turnId,
          label: 'Thinking',
          tone: 'thinking' as const
        }
      };
    }
    return {
      id: `part-${index}`,
      kind: 'work' as const,
      entry: {
        id: `part-${index}`,
        turnId,
        label: part.type,
        tone: 'text' as const
      }
    };
  });
}

/**
 * The bounded activity log owns an upward scroll that lands inside it.
 *
 * The transcript treats *any* upward wheel or key as "the reader left the live
 * edge" (see `useTranscriptScroll`), which is right while every scroller in
 * the column is the transcript itself. A tool log with its own scrollbar
 * breaks that: scrolling back through the steps of a running turn would
 * release the stick-to-bottom lock and strand the reader, so the gesture is
 * the group's whenever something between the target and the group is
 * scrolled away from its own top.
 *
 * Ported from t3code PR #9106 (`toolGroupConsumesUpwardNavigation`). Written
 * against a structural node type rather than `Element` so it is testable
 * without a DOM.
 */
export interface ScrollGestureNode {
  readonly scrollTop: number;
  readonly parentElement: ScrollGestureNode | null;
  closest(selector: string): ScrollGestureNode | null;
}

/** Marks the scroll box a tool log owns. Must match `ActivityBlock`. */
export const TOOL_GROUP_SCROLL_ATTR = 'data-tool-group-scroll';

function computedOverflowY(node: ScrollGestureNode): string {
  const view = globalThis as { getComputedStyle?: (element: never) => { overflowY?: string } };
  return view.getComputedStyle?.(node as never)?.overflowY ?? '';
}

export function toolGroupConsumesUpwardNavigation(
  target: unknown,
  readOverflowY: (node: ScrollGestureNode) => string = computedOverflowY
): boolean {
  const node =
    target && typeof (target as ScrollGestureNode).closest === 'function'
      ? (target as ScrollGestureNode)
      : null;
  const group = node?.closest(`[${TOOL_GROUP_SCROLL_ATTR}]`);
  if (!group) return false;

  // A nested result (a terminal block, a diff) or the group itself can be the
  // one with somewhere to go; anything already at its own top has not.
  for (let element: ScrollGestureNode | null = node; element; element = element.parentElement) {
    if (element.scrollTop > 0) {
      const overflowY = readOverflowY(element);
      if (overflowY === 'auto' || overflowY === 'scroll') return true;
    }
    if (element === group) break;
  }
  return false;
}

/**
 * Resolves whether the pre-flight context strip above/behind the composer
 * (project, execution target, branch, PR) should remain expanded.
 *
 * In draft hero state (before the conversation starts), it is always shown
 * to aim the first message. Once the conversation is active, it stays visible
 * only if the user turned on the `persistComposerContextStrip` preference.
 */
export function shouldShowComposerContextStrip(input: {
  readonly conversationStarted: boolean;
  readonly hasProject?: boolean;
  readonly persistComposerContextStrip: boolean;
}): boolean {
  if (!input.conversationStarted) {
    return true;
  }
  return input.persistComposerContextStrip && input.hasProject !== false;
}

export { ANTIGRAVITY_DEFAULT_MODEL, ANTIGRAVITY_CHAT_DEFAULT_MODEL };
