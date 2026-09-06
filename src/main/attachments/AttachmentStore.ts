import { mkdirSync, readFileSync, rmSync, statSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { ChatFilePart, ChatInputFilePart, StagedAttachment } from '../../shared/contracts';
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  isSupportedAttachmentMediaType,
  normalizeAttachmentMediaType,
} from '../../shared/attachments';

const MEDIA_TYPE_TO_EXTENSION: Record<string, string> = {
  'application/json': '.json',
  'application/msword': '.doc',
  'application/pdf': '.pdf',
  'application/rtf': '.rtf',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/xml': '.xml',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'text/csv': '.csv',
  'text/html': '.html',
  'text/markdown': '.md',
  'text/plain': '.txt',
};

function parseDataUrl(value: string) {
  const match = value.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i);
  if (!match) {
    throw new Error('Attachments must be sent as data URLs.');
  }

  const mediaType = match[1]?.toLowerCase() ?? '';
  const base64 = match[2] ?? '';

  return {
    mediaType,
    bytes: Buffer.from(base64, 'base64'),
  };
}

/**
 * Decode plus the two checks every entry path shares: supported type and
 * size ceiling. Errors are user copy, matching the existing send path.
 */
function decodeAndValidate(
  dataUrl: string,
  filename: string | undefined,
  mediaTypeClaim: string,
): { bytes: Buffer; mediaType: string } {
  const decoded = parseDataUrl(dataUrl);
  const mediaType = normalizeAttachmentMediaType(mediaTypeClaim || decoded.mediaType, filename);

  if (!isSupportedAttachmentMediaType(mediaType, filename)) {
    throw new Error(`${filename ?? 'This file'} is not a supported attachment type.`);
  }

  if (decoded.bytes.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error(`${filename ?? 'This file'} exceeds the attachment size limit.`);
  }

  return { bytes: decoded.bytes, mediaType };
}

/** Conversation ids are app-minted, but a hostile renderer must not steer writes. */
function assertConversationScope(rootDir: string, conversationId: string): void {
  if (!conversationId || conversationId.includes('/') || conversationId.includes('\\') || conversationId.includes('.')) {
    throw new Error('That conversation cannot hold attachments.');
  }
  const absolute = resolve(rootDir, conversationId);
  if (!absolute.startsWith(resolve(rootDir))) {
    throw new Error('Refusing to persist attachment outside the managed storage directory.');
  }
}

/**
 * Reclaims staged files from sessions that never sent them. Drafts are
 * in-memory, so anything staged here predates this launch by definition —
 * except its age, which is why the 24h floor exists rather than deleting on
 * sight. Message-owned files never carry the prefix and are untouched.
 */
export function sweepStaleStagedAttachments(rootDir: string, nowMs: number): number {
  const root = resolve(rootDir);
  let conversationDirs: string[];
  try {
    conversationDirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return 0;
  }

  let deleted = 0;
  for (const dir of conversationDirs) {
    let entries: string[];
    try {
      entries = readdirSync(join(root, dir));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith(STAGED_ATTACHMENT_PREFIX)) {
        continue;
      }
      const absolutePath = resolve(root, dir, entry);
      if (!absolutePath.startsWith(root + sep)) {
        continue;
      }
      try {
        if (nowMs - statSync(absolutePath).mtimeMs > STAGED_ATTACHMENT_MAX_AGE_MS) {
          unlinkSync(absolutePath);
          deleted += 1;
        }
      } catch {
        continue;
      }
    }
  }
  return deleted;
}

function getExtension(filename: string | undefined, mediaType: string) {
  const explicitExtension = extname(filename ?? '');
  if (explicitExtension) {
    return explicitExtension.toLowerCase();
  }

  return MEDIA_TYPE_TO_EXTENSION[mediaType] ?? '';
}

export const ATTACHMENT_SCHEME = 'atlas-attachment';
/** Fixed host, so `pathname` is exactly the storage key. */
const ATTACHMENT_HOST = 'file';

/**
 * Staged files wait under `<conversationId>/staged-<uuid><ext>` until their
 * turn is sent. The prefix is what distinguishes them from message-owned
 * files, so the startup sweep can reclaim leftovers without touching history.
 */
export const STAGED_ATTACHMENT_PREFIX = 'staged-';
/** Staged files outlive only the session that made them; drafts are in-memory. */
export const STAGED_ATTACHMENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * A renderer-loadable URL for a stored attachment.
 *
 * Storage keys are `<conversationId>/<name>`, and each segment is encoded so a
 * key can never climb out of the directory through the URL.
 */
export function buildAttachmentUrl(storageKey: string) {
  const path = storageKey.split('/').map(encodeURIComponent).join('/');
  return `${ATTACHMENT_SCHEME}://${ATTACHMENT_HOST}/${path}`;
}

export class AttachmentStore {
  constructor(private readonly rootDir: string) {
    mkdirSync(rootDir, { recursive: true });
  }

  persistAttachment(conversationId: string, attachment: ChatInputFilePart): ChatFilePart {
    const { bytes, mediaType } = decodeAndValidate(attachment.url, attachment.filename, attachment.mediaType);

    const extension = getExtension(attachment.filename, mediaType);
    const storageKey = join(conversationId, `${Date.now()}-${randomUUID()}${extension}`);
    const absolutePath = resolve(this.rootDir, storageKey);

    if (!absolutePath.startsWith(resolve(this.rootDir))) {
      throw new Error('Refusing to persist attachment outside the managed storage directory.');
    }

    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, bytes);

    return {
      id: randomUUID(),
      type: 'file',
      filename: attachment.filename,
      mediaType,
      sizeBytes: attachment.sizeBytes ?? bytes.byteLength,
      storageKey,
      url: buildAttachmentUrl(storageKey),
    };
  }

  /**
   * Persists staged composer bytes ahead of their turn (t3code PR #8048's
   * upload-before-send, without the signed URLs — this IPC is local and the
   * renderer is trusted, so bytes arrive directly).
   *
   * The file lands under the `staged-` prefix and stays there until a send
   * adopts it by reference. Anything never sent is reclaimed by the startup
   * sweep or by conversation delete; removing a chip calls
   * `deleteStagedAttachment` eagerly.
   */
  stageAttachment(
    conversationId: string,
    input: { filename?: string; mediaType: string; dataUrl: string },
  ): StagedAttachment {
    assertConversationScope(this.rootDir, conversationId);
    const { bytes, mediaType } = decodeAndValidate(input.dataUrl, input.filename, input.mediaType);

    const extension = getExtension(input.filename, mediaType);
    const storageKey = join(conversationId, `${STAGED_ATTACHMENT_PREFIX}${randomUUID()}${extension}`);
    const absolutePath = resolve(this.rootDir, storageKey);

    if (!absolutePath.startsWith(resolve(this.rootDir))) {
      throw new Error('Refusing to persist attachment outside the managed storage directory.');
    }

    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, bytes);

    return { storageKey, mediaType, sizeBytes: bytes.byteLength };
  }

  /**
   * Adopts a staged file into a turn by reference — no copy, no re-decode.
   * The staged file *becomes* message-owned; the draft entry that pointed at
   * it is retired by the send. A failed send leaves the staged file (and the
   * draft entry) intact, so retrying costs nothing.
   */
  adoptStagedAttachment(
    conversationId: string,
    storageKey: string,
    claimed: { filename?: string; mediaType: string },
  ): { storageKey: string; mediaType: string; filename?: string; sizeBytes: number } {
    const absolutePath = this.resolveStagedPath(conversationId, storageKey);

    let bytes: Buffer;
    try {
      bytes = readFileSync(absolutePath);
    } catch {
      throw new Error(
        `${claimed.filename ?? 'This attachment'} is no longer available. Remove it and attach again.`,
      );
    }

    if (bytes.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new Error(`${claimed.filename ?? 'This file'} exceeds the attachment size limit.`);
    }

    const mediaType = normalizeAttachmentMediaType(claimed.mediaType, claimed.filename);
    if (!isSupportedAttachmentMediaType(mediaType, claimed.filename)) {
      throw new Error(`${claimed.filename ?? 'This file'} is not a supported attachment type.`);
    }

    return { storageKey, mediaType, filename: claimed.filename, sizeBytes: bytes.byteLength };
  }

  /** Removes one staged file. Anything outside the staged prefix is refused. */
  deleteStagedAttachment(conversationId: string, storageKey: string): void {
    const absolutePath = this.resolveStagedPath(conversationId, storageKey);
    try {
      rmSync(absolutePath, { force: true });
    } catch {
      // Best-effort: the sweep reclaims whatever this misses.
    }
  }

  /** Resolves a staged key, refusing anything outside its conversation scope. */
  private resolveStagedPath(conversationId: string, storageKey: string): string {
    assertConversationScope(this.rootDir, conversationId);
    const root = resolve(this.rootDir);
    const absolutePath = resolve(root, storageKey);
    const scopePrefix = join(conversationId, STAGED_ATTACHMENT_PREFIX);
    const relative = absolutePath.startsWith(root + sep) ? absolutePath.slice(root.length + 1) : '';

    if (!relative || !relative.startsWith(scopePrefix)) {
      throw new Error('Refusing to touch an attachment outside its staged scope.');
    }
    return absolutePath;
  }

  /**
   * Duplicate a stored blob under another conversation, returning the new key.
   *
   * Forking has to copy rather than share, and the reason is two lines down in
   * this file: storage keys are `<conversationId>/<name>` and
   * `deleteConversationAttachments` removes that whole directory. A fork that
   * pointed at its parent's keys would render fine until the day the parent was
   * deleted, at which point every image in the fork would silently break — with
   * no row anywhere recording that the fork had a claim on those bytes.
   * Reference counting would fix that; copying the handful of blobs a forked
   * prefix actually mentions fixes it without inventing a GC.
   *
   * Returns null when the source is gone, so a fork of a conversation whose
   * attachments were already deleted still succeeds and simply carries the same
   * broken reference the parent had.
   */
  copyAttachment(storageKey: string, targetConversationId: string): string | null {
    const sourcePath = resolve(this.rootDir, storageKey);
    if (!sourcePath.startsWith(resolve(this.rootDir))) {
      return null;
    }

    // The name is regenerated rather than reused: two conversations holding the
    // same filename is harmless, but a key minted fresh cannot collide with
    // whatever the target conversation already stored.
    const extension = extname(storageKey);
    const targetKey = join(targetConversationId, `${Date.now()}-${randomUUID()}${extension}`);
    const targetPath = resolve(this.rootDir, targetKey);

    if (!targetPath.startsWith(resolve(this.rootDir))) {
      return null;
    }

    try {
      const bytes = readFileSync(sourcePath);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, bytes);
      return targetKey;
    } catch {
      return null;
    }
  }

  readAttachmentData(storageKey: string) {
    const absolutePath = resolve(this.rootDir, storageKey);
    if (!absolutePath.startsWith(resolve(this.rootDir))) {
      return null;
    }

    try {
      return readFileSync(absolutePath);
    } catch {
      return null;
    }
  }

  deleteConversationAttachments(conversationId: string) {
    const conversationDir = resolve(this.rootDir, conversationId);
    if (!conversationDir.startsWith(resolve(this.rootDir))) {
      return;
    }

    rmSync(conversationDir, { force: true, recursive: true });
  }
}
