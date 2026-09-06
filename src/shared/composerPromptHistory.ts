/**
 * Terminal-style prompt recall for the composer, ported from t3code PR #9173.
 *
 * ArrowUp on an empty composer walks back through the active conversation's
 * sent prompts, ArrowDown walks forward and clears past the newest entry.
 *
 * History is per conversation and text only. It is derived from the
 * conversation's user messages on every keypress, so there is no store to
 * persist or sync. Attachments are never restored.
 *
 * Kept in `shared/` and free of React so it can be unit-tested directly, the
 * same reason `planTool.ts` lives here.
 */

import { collectAssistantCitations } from './citations';

export type ComposerPromptHistoryMessage = {
  readonly id: string;
  readonly role: string;
  readonly text: string;
};

export type ComposerPromptHistoryEntry = {
  readonly id: string;
  readonly prompt: string;
};

/**
 * Active recall. `entryId` is resolved against the current entries on every
 * step, so a reload replacing messages cannot move the position. `recalled`
 * is the text put in the composer; once the composer no longer matches it,
 * the user has edited or sent and browsing is over.
 */
export type ComposerPromptHistoryPosition = {
  readonly entryId: string;
  readonly recalled: string;
};

export type ComposerPromptHistoryStep = {
  readonly position: ComposerPromptHistoryPosition | null;
  readonly prompt: string;
};

/**
 * Prefer the id. A consecutive duplicate collapse can retire the recalled
 * id while the same text lives on under a newer one, so fall back to the
 * newest entry with matching text.
 */
function findActive(
  entries: ReadonlyArray<ComposerPromptHistoryEntry>,
  position: ComposerPromptHistoryPosition,
): number {
  const byId = entries.findIndex((entry) => entry.id === position.entryId);
  if (byId >= 0) return byId;
  return entries.findLastIndex((entry) => entry.prompt === position.recalled);
}

/**
 * Drop the tray citation links `mergeCitationsIntoMessage` appends at send
 * time, which sit at the end. Cuts at the start of the trailing run of links
 * so a citation link the user typed earlier stays byte-for-byte.
 */
function stripTrailingAssistantCitations(prompt: string): string {
  const matches = collectAssistantCitations(prompt);
  let cut = prompt.length;
  for (let index = matches.length - 1; index >= 0; index--) {
    const match = matches[index]!;
    if (prompt.slice(match.end, cut).trim().length > 0) break;
    cut = match.start;
  }
  return cut === prompt.length ? prompt : prompt.slice(0, cut).trimEnd();
}

/**
 * Reduce a sent message to the text the user typed. Tray citation links
 * appended at send time are stripped so a recalled prompt never carries
 * href bytes the draft never held.
 */
export function recallableComposerPrompt(messageText: string): string {
  let prompt = messageText.trim();
  while (prompt.length > 0) {
    const stripped = stripTrailingAssistantCitations(prompt).trim();
    if (stripped === prompt) break;
    prompt = stripped;
  }
  return prompt;
}

/**
 * Oldest first. Consecutive identical prompts collapse into the newest one,
 * matching shell `HISTCONTROL=ignoredups`. Attachment-only sends have no
 * text and are skipped.
 */
export function buildComposerPromptHistoryEntries(
  messages: ReadonlyArray<ComposerPromptHistoryMessage>,
): ComposerPromptHistoryEntry[] {
  const entries: ComposerPromptHistoryEntry[] = [];
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const prompt = recallableComposerPrompt(message.text);
    if (prompt.length === 0) continue;
    const previous = entries[entries.length - 1];
    if (previous && previous.prompt === prompt) {
      entries[entries.length - 1] = { id: message.id, prompt };
      continue;
    }
    entries.push({ id: message.id, prompt });
  }
  return entries;
}

/**
 * Returns null when the key should fall through to normal caret movement.
 * Backward starts only from an empty composer and stops at the oldest entry.
 * Forward past the newest entry empties the composer and ends browsing. An
 * edited or sent recall no longer matches `recalled`, so browsing restarts
 * from scratch on the next backward step.
 */
export function stepComposerPromptHistory(input: {
  readonly direction: 'backward' | 'forward';
  readonly entries: ReadonlyArray<ComposerPromptHistoryEntry>;
  readonly position: ComposerPromptHistoryPosition | null;
  readonly currentPrompt: string;
}): ComposerPromptHistoryStep | null {
  const { entries, position, currentPrompt } = input;
  const activeIndex =
    position && position.recalled === currentPrompt ? findActive(entries, position) : -1;

  if (input.direction === 'backward') {
    if (activeIndex < 0 && currentPrompt.length > 0) return null;
    const entry = entries[activeIndex < 0 ? entries.length - 1 : activeIndex - 1];
    if (!entry) return null;
    return { position: { entryId: entry.id, recalled: entry.prompt }, prompt: entry.prompt };
  }

  if (activeIndex < 0) return null;
  const entry = entries[activeIndex + 1];
  if (!entry) return { position: null, prompt: '' };
  return { position: { entryId: entry.id, recalled: entry.prompt }, prompt: entry.prompt };
}
