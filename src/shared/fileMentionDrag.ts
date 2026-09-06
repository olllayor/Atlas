/**
 * Drag workspace files from the Files panel into the chat composer.
 *
 * Ported from t3code PR #4140 (there against a Lexical editor with
 * `[name](path)` mention pills, here against the plain textarea).
 *
 * Atlas-shaped divergence: the composer holds plain text plus tray objects,
 * and there is no file-link pill grammar — `@` mentions and
 * `atlas-citation://` links are the only structured inserts, and neither
 * names a workspace file. A drop therefore inserts the path as inline code
 * (`` `relative/path` ``), which renders unambiguously in chat markdown,
 * never collides with the mention/citation grammars, and stays readable in
 * the draft the user edits.
 *
 * Two halves, mirroring upstream:
 * - the tree side tags row drags with a custom MIME payload so the composer
 *   can tell them apart from OS file drags and plain text selections;
 * - the composer side claims those drags in the capture phase so the
 *   textarea never sees the drop.
 *
 * Pure TypeScript, no React — testable like the citation grammar.
 */

/**
 * Drag payload type carrying a serialized file reference. Set on drags that
 * start on a Files panel row so the composer can tell them apart from OS
 * file drags and plain text selections.
 */
export const FILE_MENTION_DRAG_TYPE = 'application/x-atlas-file-mention';

/** Row attribute carrying the workspace-relative path of a draggable row. */
export const FILE_ROW_PATH_ATTR = 'data-file-path';

/**
 * Serialize a tree path into the text a drop inserts. Directory rows carry a
 * trailing slash; it is stripped so the reference names the path itself.
 * Null when there is no path to reference.
 */
export function composerFileMentionFromPath(filePath: string): string | null {
  const relativePath = filePath.replace(/\/+$/, '');
  if (relativePath.length === 0) {
    return null;
  }
  return `\`${relativePath}\``;
}

export function dataTransferHasFileMention(types: ReadonlyArray<string>): boolean {
  return types.includes(FILE_MENTION_DRAG_TYPE);
}

export interface FileMentionDragTransfer {
  readonly types: ReadonlyArray<string>;
  getData(format: string): string;
  dropEffect: string;
}

export interface FileMentionDragEvent {
  readonly dataTransfer: FileMentionDragTransfer;
  readonly nativeEvent: { stopPropagation(): void };
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * What a file-mention drop is allowed to do to the composer. Deliberately
 * narrow: there is no way to focus the editor from here. The caller focuses
 * on the next frame, after the controlled value has landed and the caret can
 * be placed at the end.
 */
export interface FileMentionDropHost {
  insertMentionAtEnd(text: string): boolean;
  setDragActive(active: boolean): void;
  onInsertRejected(): void;
}

export interface FileMentionDragHandlers {
  onDragEnter(event: FileMentionDragEvent): void;
  onDragOver(event: FileMentionDragEvent): void;
  onDrop(event: FileMentionDragEvent): void;
}

export function makeComposerFileMentionDragHandlers(
  host: FileMentionDropHost
): FileMentionDragHandlers {
  // Claim the event for the composer: React's stopPropagation only halts the
  // synthetic dispatch, so the native event must be stopped too or the
  // textarea's own DOM listeners still process the drag.
  const claim = (event: FileMentionDragEvent): boolean => {
    if (!dataTransferHasFileMention(event.dataTransfer.types)) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopPropagation();
    return true;
  };
  return {
    onDragEnter(event) {
      if (claim(event)) {
        host.setDragActive(true);
      }
    },
    onDragOver(event) {
      if (!claim(event)) {
        return;
      }
      // The tree constrains its drags to effectAllowed "move"; naming any
      // other effect makes the browser cancel the drop without firing it.
      event.dataTransfer.dropEffect = 'move';
      host.setDragActive(true);
    },
    onDrop(event) {
      if (!claim(event)) {
        return;
      }
      host.setDragActive(false);
      const mention = event.dataTransfer.getData(FILE_MENTION_DRAG_TYPE);
      if (mention.length === 0) {
        return;
      }
      if (!host.insertMentionAtEnd(`${mention} `)) {
        host.onInsertRejected();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tree side
// ---------------------------------------------------------------------------

interface FileTreeDragTransfer {
  setData(format: string, data: string): void;
}

export interface FileTreeDragStartEvent {
  readonly dataTransfer: FileTreeDragTransfer | null;
  composedPath(): ReadonlyArray<unknown>;
}

export interface FileTreeDragController {
  /**
   * True from the moment a row drag starts until it ends. Atlas rows hold no
   * selection state, so this only guards against a drag's side effects being
   * read as intent — today that means nothing fires, but the flag keeps the
   * gesture distinguishable if rows ever gain selection-driven behavior.
   */
  isDragInProgress(): boolean;
  handleDragStart(event: FileTreeDragStartEvent): void;
  handleDragEnd(): void;
}

const rowPathOf = (node: unknown): string | null => {
  if (typeof node !== 'object' || node === null) {
    return null;
  }
  const element = node as { getAttribute?: (name: string) => string | null };
  return typeof element.getAttribute === 'function'
    ? element.getAttribute(FILE_ROW_PATH_ATTR)
    : null;
};

/**
 * Tags Files-panel row drags with the composer file-mention payload.
 *
 * Only drags that originate on a row carrying the path attribute are
 * mentions; anything else — a text selection dragged out of the panel
 * chrome, a drag with no row under it — is left alone so the composer can
 * never receive a broken reference.
 */
export function createFileTreeDragController(): FileTreeDragController {
  let dragging = false;
  return {
    isDragInProgress: () => dragging,
    handleDragStart(event) {
      if (event.dataTransfer === null) {
        return;
      }
      let rowPath: string | null = null;
      for (const node of event.composedPath()) {
        rowPath = rowPathOf(node);
        if (rowPath !== null) {
          break;
        }
      }
      if (rowPath === null) {
        return;
      }
      const mention = composerFileMentionFromPath(rowPath);
      if (mention === null) {
        return;
      }
      dragging = true;
      event.dataTransfer.setData(FILE_MENTION_DRAG_TYPE, mention);
    },
    handleDragEnd() {
      dragging = false;
    },
  };
}
