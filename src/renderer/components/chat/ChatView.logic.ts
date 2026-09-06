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

export { ANTIGRAVITY_DEFAULT_MODEL, ANTIGRAVITY_CHAT_DEFAULT_MODEL };
