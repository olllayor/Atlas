/**
 * Raw transcript mode — Codex's `/raw`.
 *
 * One boolean, read straight from the persisted appearance settings by the
 * handful of transcript components that change shape under it. It is
 * deliberately *not* prop-drilled: the cells that need it (tool cells, the
 * diff table, the changed-files bar) sit four to six levels below
 * `ChatWindow`, all of them behind memo boundaries, and threading a prop
 * through that chain would touch far more surface than the feature is worth.
 * `ToolCell` already reads `useTranscriptUiStore` this way.
 *
 * Global rather than per-conversation: it is a property of how the reader
 * wants to read, not of the conversation being read — the same reason
 * `reduceMotion` and `pointerCursors` are global.
 */

import { useAppStore } from '../stores/useAppStore';

/** True when the transcript should render as plain text. */
export function useRawTranscript(): boolean {
  return useAppStore((state) => state.settings?.appearance.rawTranscript ?? false);
}

/**
 * Shared class for every raw-mode text block.
 *
 * `whitespace-pre-wrap` (not `pre`) on purpose: a raw block that scrolls
 * sideways hides its own tail from a drag-select, which is the one thing raw
 * mode has to get right. `break-words` keeps a long URL or a minified line
 * from pushing the transcript wider than the window.
 */
export const RAW_BLOCK = 'whitespace-pre-wrap break-words';
