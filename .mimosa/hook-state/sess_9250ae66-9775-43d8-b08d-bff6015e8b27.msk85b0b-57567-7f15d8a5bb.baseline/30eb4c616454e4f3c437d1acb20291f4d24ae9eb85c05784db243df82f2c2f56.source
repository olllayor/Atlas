import { MCP_UI_MAX_HTML_BYTES } from '../../../shared/mcpUi';
import type { McpUiDescriptor } from '../../../shared/mcpUi';

/**
 * UI components returned by tool calls, held out of the model's context.
 *
 * A `ui://` resource is markup. Putting it in the tool's result string would
 * send a page of HTML to the model on the turn it arrives and on every turn
 * after, which is the exact cost the two-phase skill design exists to avoid —
 * and the model cannot act on markup anyway. So the result string keeps a
 * one-line mention and the bytes come here, keyed by the call that produced
 * them.
 *
 * Memory-only and deliberately not persisted. A widget is a view of a moment: a
 * component rendered from last week's tool call would be showing state the
 * server has long since changed, and reviving one after a restart means
 * executing third-party markup the user never asked to see again.
 */

/** Enough for a long conversation's worth of visible cards; the oldest fall off. */
const MAX_ENTRIES = 64;

export type McpUiEntry = McpUiDescriptor & { html: string };

export class McpUiStore {
  /** Insertion-ordered, which is what makes the eviction below oldest-first. */
  private readonly entries = new Map<string, McpUiEntry>();

  /**
   * Records a component, or refuses it.
   *
   * Returns whether it was kept, because the caller writes a different sentence
   * into the model's result depending on whether a frame will appear. Telling
   * the model a component is below when none rendered is worse than saying
   * nothing: it invites the model to talk about a card the user cannot see.
   */
  put(entry: McpUiEntry): boolean {
    if (!entry.toolCallId || !entry.html.trim()) {
      return false;
    }

    // Byte length, not character count: the ceiling is about memory and render
    // cost, and a page of CJK or emoji is several times its own length in UTF-8.
    if (Buffer.byteLength(entry.html, 'utf8') > MCP_UI_MAX_HTML_BYTES) {
      return false;
    }

    // Re-inserted rather than updated in place so a refreshed component is the
    // newest entry and does not get evicted on its own age.
    this.entries.delete(entry.toolCallId);
    this.entries.set(entry.toolCallId, entry);

    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next();

      if (oldest.done) {
        break;
      }

      this.entries.delete(oldest.value);
    }

    return true;
  }

  /** The markup, for the protocol handler. */
  get(toolCallId: string): McpUiEntry | null {
    return this.entries.get(toolCallId) ?? null;
  }

  /**
   * What the renderer is told, which is everything except the markup.
   *
   * The renderer never receives the HTML over IPC. It receives a descriptor and
   * points a frame at a URL, so the only process that ever holds widget markup
   * in a context with real privileges is the one that also refuses to run it.
   */
  describe(toolCallId: string): McpUiDescriptor | null {
    const entry = this.entries.get(toolCallId);

    return entry ? { toolCallId: entry.toolCallId, uri: entry.uri, serverName: entry.serverName } : null;
  }

  /** Test and shutdown seam. */
  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
