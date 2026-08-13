import type {
  ChatFilePart,
  ChatInputFilePart,
  ChatInputPart,
  ChatMessagePart,
  ModelSummary,
} from './contracts';

/**
 * `text` is split out from `document` because it costs no model capability at
 * all: a `.md`, `.csv` or `.json` is inlined into the prompt as text before the
 * request is built, so any model can take one. Only formats that have to travel
 * as binary — PDF and the Office family — need real document support.
 */
type AttachmentKind = 'image' | 'text' | 'document' | 'unsupported';

const EXTENSION_TO_MEDIA_TYPE: Record<string, string> = {
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html',
  json: 'application/json',
  md: 'text/markdown',
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf',
  text: 'text/plain',
  txt: 'text/plain',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml',
};

const DOCUMENT_MEDIA_TYPES = new Set<string>([
  'application/json',
  'application/msword',
  'application/pdf',
  'application/rtf',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/xml',
  'text/csv',
  'text/html',
  'text/markdown',
  'text/plain',
]);

export const MAX_ATTACHMENT_COUNT = 8;
export const MAX_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = 30 * 1024 * 1024;

export const ATTACHMENT_ACCEPT_ATTRIBUTE = [
  'image/*',
  'text/*',
  'application/json',
  'application/msword',
  'application/pdf',
  'application/rtf',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/xml',
].join(',');

function getFileExtension(filename: string | undefined) {
  if (!filename?.includes('.')) {
    return '';
  }

  return filename.slice(filename.lastIndexOf('.') + 1).trim().toLowerCase();
}

export function normalizeAttachmentMediaType(mediaType: string | undefined, filename?: string) {
  const normalized = mediaType?.split(';', 1)[0]?.trim().toLowerCase();
  if (normalized) {
    return normalized;
  }

  return EXTENSION_TO_MEDIA_TYPE[getFileExtension(filename)] ?? '';
}

/** Formats whose bytes are legible as UTF-8 and can be inlined as prompt text. */
const TEXT_MEDIA_TYPES = new Set<string>(['application/json', 'application/xml']);

export function isInlinableTextMediaType(mediaType: string, filename?: string) {
  const normalized = normalizeAttachmentMediaType(mediaType, filename);
  return normalized.startsWith('text/') || TEXT_MEDIA_TYPES.has(normalized);
}

export function getAttachmentKind(mediaType: string) {
  const normalized = normalizeAttachmentMediaType(mediaType);
  if (normalized.startsWith('image/')) {
    return 'image' satisfies AttachmentKind;
  }

  if (isInlinableTextMediaType(normalized)) {
    return 'text' satisfies AttachmentKind;
  }

  if (DOCUMENT_MEDIA_TYPES.has(normalized)) {
    return 'document' satisfies AttachmentKind;
  }

  return 'unsupported' satisfies AttachmentKind;
}

export function isSupportedAttachmentMediaType(mediaType: string, filename?: string) {
  return getAttachmentKind(normalizeAttachmentMediaType(mediaType, filename)) !== 'unsupported';
}

export function getAttachmentCapabilityError(
  model: Pick<ModelSummary, 'supportsVision' | 'supportsDocumentInput'> | null,
  attachments: Array<Pick<ChatInputFilePart, 'filename' | 'mediaType'> | Pick<ChatFilePart, 'filename' | 'mediaType'>>,
) {
  if (!attachments.length) {
    return null;
  }

  if (!model) {
    return 'Select a model before sending attachments.';
  }

  let needsVision = false;
  let needsDocuments = false;

  for (const attachment of attachments) {
    const normalized = normalizeAttachmentMediaType(attachment.mediaType, attachment.filename);
    const kind = getAttachmentKind(normalized);

    if (kind === 'unsupported') {
      return `${attachment.filename ?? 'This file'} is not a supported attachment type.`;
    }

    if (kind === 'image') {
      needsVision = true;
      continue;
    }

    // Text is inlined into the prompt, so it asks nothing of the model.
    if (kind === 'text') {
      continue;
    }

    needsDocuments = true;
  }

  // Only a known `false` blocks. `null` means the catalog never described this
  // model, and refusing to try would make Atlas the thing that cannot send the
  // image rather than the model.
  if (needsVision && model.supportsVision === false) {
    return 'The selected model does not support image attachments.';
  }

  if (needsDocuments && model.supportsDocumentInput === false) {
    return 'The selected model does not support document attachments.';
  }

  return null;
}

export function sumAttachmentSize(
  attachments: Array<Pick<ChatInputFilePart, 'sizeBytes'> | Pick<ChatFilePart, 'sizeBytes'>>,
) {
  return attachments.reduce((sum, attachment) => sum + Math.max(0, attachment.sizeBytes ?? 0), 0);
}

export function getAttachmentSummaryLabel(count: number, imageCount: number) {
  if (count <= 0) {
    return '';
  }

  if (count === 1) {
    return imageCount === 1 ? 'Image' : 'Attachment';
  }

  return imageCount === count ? `${count} images` : `${count} attachments`;
}

export function getContentPreviewText(
  content: string,
  parts: Array<ChatInputPart | ChatMessagePart> | undefined,
) {
  const trimmed = content.trim();
  if (trimmed) {
    return trimmed;
  }

  const textFromParts = (parts ?? [])
    .filter(
      (part): part is Extract<ChatInputPart | ChatMessagePart, { type: 'text' }> => part.type === 'text',
    )
    .map(part => part.text)
    .join('\n\n')
    .trim();

  if (textFromParts) {
    return textFromParts;
  }

  const fileParts = (parts ?? []).filter(
    (part): part is ChatInputFilePart | ChatFilePart => part.type === 'file',
  );

  if (!fileParts.length) {
    return '';
  }

  const imageCount = fileParts.filter(
    part => getAttachmentKind(normalizeAttachmentMediaType(part.mediaType, part.filename)) === 'image',
  ).length;

  return getAttachmentSummaryLabel(fileParts.length, imageCount);
}

export function getMessageFileParts(parts: ChatMessagePart[]) {
  return parts.filter((part): part is ChatFilePart => part.type === 'file');
}
