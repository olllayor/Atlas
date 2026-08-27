import type { ChatMessage } from '../../shared/contracts.js';

/**
 * Pure geometry + derivation helpers for the transcript timeline minimap.
 * Pattern ported from t3code's `MessagesTimeline.logic.ts`; the constants are
 * re-tuned to Atlas's content column, which is `clamp(680px, 102vw, 860px)`.
 *
 * Everything here is DOM-free so it can unit-test in plain Node.
 */

export const MINIMAP_ITEM_SPACING = 8;
/** Below this many jumps a rail is chrome without a job. */
export const MINIMAP_MIN_ITEMS = 2;
export const MINIMAP_MAX_HEIGHT_CSS = 'calc(100vh - 18rem)';
/**
 * Mirror of the CSS `--content-max: clamp(680px, 102vw, 860px)` token. Kept
 * in one place with a comment pointing at styles.css — if the token moves,
 * this must move with it or the gutter math lies.
 */
export const CONTENT_MIN_WIDTH = 680;
export const CONTENT_MAX_WIDTH = 860;
export const CONTENT_PREFERRED_RATIO = 1.02;
/** Side gutter at which the rail stays permanently visible (no hover reveal). */
export const MINIMAP_PERSISTENT_GUTTER = 48;
export const MINIMAP_HIT_STRIP_LEFT = 12;
export const MINIMAP_HIT_STRIP_MAX_WIDTH = 40;
export const MINIMAP_EXPANDED_HIT_STRIP_WIDTH = '22rem';
/** Preview text cap per message; the card clamps visually on top of this. */
const PREVIEW_MAX_CHARS = 240;

export interface MinimapItem {
  /** Message id — stable React key and strip-map key. */
  readonly id: string;
  /** Index into the virtualized rows (`messages` array). */
  readonly rowIndex: number;
  readonly userText: string;
  readonly assistantText: string | null;
}

export interface VirtualRange {
  readonly startIndex: number;
  readonly endIndex: number;
}

/** The preferred content width for a viewport, mirroring the clamp() above. */
export function resolveContentWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return CONTENT_MIN_WIDTH;
  return Math.min(CONTENT_MAX_WIDTH, Math.max(CONTENT_MIN_WIDTH, viewportWidth * CONTENT_PREFERRED_RATIO));
}

export function resolveMinimapHeightStyle(itemCount: number): string {
  const naturalHeight = Math.max(1, (itemCount - 1) * MINIMAP_ITEM_SPACING);
  return `min(${naturalHeight}px, ${MINIMAP_MAX_HEIGHT_CSS})`;
}

export function resolveMinimapTopPercent(index: number, itemCount: number): number {
  if (itemCount <= 1) return 0;
  return (Math.max(0, Math.min(index, itemCount - 1)) / (itemCount - 1)) * 100;
}

export function resolveMinimapIndexFromPointer(input: {
  readonly itemCount: number;
  readonly railTop: number;
  readonly railHeight: number;
  readonly pointerY: number;
}): number | null {
  if (input.itemCount <= 0 || input.railHeight <= 0) return null;
  if (input.itemCount === 1) return 0;

  const progress = Math.max(0, Math.min(1, (input.pointerY - input.railTop) / input.railHeight));
  return Math.max(0, Math.min(input.itemCount - 1, Math.round(progress * (input.itemCount - 1))));
}

export function resolveMinimapHasPersistentGutter(viewportWidth: number): boolean {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return false;

  const sideGutter = Math.max(0, (viewportWidth - resolveContentWidth(viewportWidth)) / 2);
  return sideGutter >= MINIMAP_PERSISTENT_GUTTER;
}

/**
 * The rail overlays the viewport's left edge while the content column is
 * centered, so the gutter between them shrinks under zoom or a narrow pane.
 * Cap the hit strip so it never extends past the gutter into the message
 * text; 0 disables it entirely.
 */
export function resolveMinimapHitStripWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0;

  const sideGutter = Math.max(0, (viewportWidth - resolveContentWidth(viewportWidth)) / 2);
  return Math.max(
    0,
    Math.min(MINIMAP_HIT_STRIP_MAX_WIDTH, Math.floor(sideGutter) - MINIMAP_HIT_STRIP_LEFT)
  );
}

/** Once the preview is open keep the full strip interactive; collapsed stays gutter-capped. */
export function resolveMinimapInteractiveWidth(
  collapsedWidth: number,
  expanded: boolean
): number | string {
  return expanded ? MINIMAP_EXPANDED_HIT_STRIP_WIDTH : collapsedWidth;
}

/** Tick lights up when its row is inside the rendered virtual window (+1 row slack each side). */
export function isRowInView(rowIndex: number, range: VirtualRange | null | undefined): boolean {
  if (!range) return false;
  return rowIndex >= range.startIndex - 1 && rowIndex <= range.endIndex + 1;
}

function compactPreview(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= PREVIEW_MAX_CHARS) return compact;
  return `${compact.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
}

/**
 * One jump per user turn. The assistant preview is the *final* assistant
 * message before the next user speaks — earlier streaming fragments of the
 * same turn are noise in a jump list.
 */
export function deriveMinimapItems(messages: readonly ChatMessage[]): MinimapItem[] {
  const items: MinimapItem[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    // Skip system rows entirely: they are never something you jump back to.
    if (!message || message.role !== 'user') continue;

    let assistantText: string | null = null;
    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      const next = messages[cursor];
      if (!next || next.role === 'user') break;
      if (next.role === 'assistant' && next.content.trim()) {
        assistantText = next.content;
      }
    }

    items.push({
      id: message.id,
      rowIndex: index,
      userText: compactPreview(message.content),
      assistantText: assistantText ? compactPreview(assistantText) : null,
    });
  }

  return items;
}
