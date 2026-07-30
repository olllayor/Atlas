import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { ChatFilePart, ChatInputFilePart } from '../../shared/contracts';
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
    const decoded = parseDataUrl(attachment.url);
    const mediaType = normalizeAttachmentMediaType(
      attachment.mediaType || decoded.mediaType,
      attachment.filename,
    );

    if (!isSupportedAttachmentMediaType(mediaType, attachment.filename)) {
      throw new Error(`${attachment.filename ?? 'This file'} is not a supported attachment type.`);
    }

    if (decoded.bytes.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new Error(`${attachment.filename ?? 'This file'} exceeds the attachment size limit.`);
    }

    const extension = getExtension(attachment.filename, mediaType);
    const storageKey = join(conversationId, `${Date.now()}-${randomUUID()}${extension}`);
    const absolutePath = resolve(this.rootDir, storageKey);

    if (!absolutePath.startsWith(resolve(this.rootDir))) {
      throw new Error('Refusing to persist attachment outside the managed storage directory.');
    }

    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, decoded.bytes);

    return {
      id: randomUUID(),
      type: 'file',
      filename: attachment.filename,
      mediaType,
      sizeBytes: attachment.sizeBytes ?? decoded.bytes.byteLength,
      storageKey,
      url: buildAttachmentUrl(storageKey),
    };
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
