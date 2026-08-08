/**
 * User-facing copy for anything that crosses the IPC boundary.
 *
 * A handler throws whatever sentence was easiest to write where the failure was
 * detected — "Attachments must be sent as data URLs." is a statement about our
 * own wire format — and the renderer puts that string straight into a toast.
 * This is the one place where an internal invariant becomes a sentence that
 * names the file, the limit or the next action, and the only place the raw
 * error is recorded before it is replaced.
 *
 * The translation is an explicit list rather than a heuristic. "Does this read
 * like prose a user could act on" is not a decidable question, and guessing it
 * wrong either leaks an invariant into the UI or throws away a good sentence.
 */

import { MAX_ATTACHMENT_COUNT } from '../../shared/attachments';
import { normalizeError } from '../ai/core/ErrorNormalizer';
import { logger } from '../observability/logger';

const GENERIC_MESSAGE = 'Something went wrong. Try again.';

/** Errors whose message is a validation sentence by construction. */
const USER_FACING_ERROR_NAMES = new Set(['CustomProviderValidationError']);

/** Internal invariants, and what the user is actually meant to do about them. */
const REPLACEMENTS = new Map([
  ['Attachments must be sent as data URLs.', 'That file could not be read. Remove it and attach it again.'],
  [
    'Too many attachments were provided.',
    `You can attach up to ${MAX_ATTACHMENT_COUNT} files to a message. Remove a few and send again.`
  ],
  [
    'Attachments are too large to send together.',
    'Those attachments are too large to send together. Remove one, or attach a smaller file.'
  ],
  ['Chat requests must end with a user message.', 'Write a message before sending.'],
  [
    'Refusing to persist attachment outside the managed storage directory.',
    'That file could not be saved. Remove it and attach it again.'
  ],
  ['Approval target is no longer active.', 'That request already finished, so the approval was not needed.'],
  ['Approval request was not found.', 'That approval is no longer waiting for an answer.'],
  ['Failed to save visual', 'That visual could not be saved. Try again.'],
  ['Failed to persist the provider.', 'That provider could not be saved. Try again.'],
  ['GitHub returned an unexpected release payload.', 'Atlas could not read the update details. Try again later.'],
  [
    'Unable to resolve the source window for this chat request.',
    'Atlas lost track of this window. Reopen the chat and try again.'
  ],
  [
    'Unable to resolve the source window for this visual request.',
    'Atlas lost track of this window. Reopen the chat and try again.'
  ]
]);

/** The same, for invariants that interpolate an id, a path or a status code. */
const PATTERN_REPLACEMENTS: Array<{ pattern: RegExp; message: string }> = [
  // A blocked sender is a security event: the user learns nothing useful from
  // the origin, and an attacker should not be told what was checked.
  { pattern: /^Blocked IPC from untrusted sender:/, message: 'That request was blocked for security reasons.' },
  { pattern: /^Unknown workspace mode:/, message: 'That workspace mode is not available in this version of Atlas.' },
  { pattern: /^Project .+ not found\.$/, message: 'That project is no longer attached. Pick the folder again.' },
  { pattern: /^Conversation (?:.+ not found\.|not found: .+)$/, message: 'That conversation is no longer available.' },
  { pattern: /^Message not found:/, message: 'That message is no longer available.' },
  {
    pattern: /^(?:Invalid site file path:|Site file path escapes the site root:|Not a regular file:)/,
    message: 'That file path is not valid for this site.'
  },
  { pattern: /^Invalid site identifier:/, message: 'That site could not be found.' },
  { pattern: /^Failed to create site/, message: 'That site could not be created. Try again.' },
  { pattern: /^GitHub returned \d+ while checking for updates\.$/, message: 'Atlas could not check for updates. Try again later.' },
  { pattern: /^Unsupported app version:/, message: 'Atlas could not check for updates for this build.' }
];

/** Messages that were already written for a user; wrapping them would lose detail. */
const USER_FACING_MESSAGES = new Set([
  'Save an API key first.',
  'Add a provider API key in settings before refreshing models.',
  'Provider API key cannot be empty.',
  'Conversation title cannot be empty.',
  'Project title cannot be empty.',
  'That provider no longer exists.',
  'That folder is no longer on disk.',
  'No update action is available right now.',
  'In-app installation is not enabled for this release channel yet.',
  'Select a model before sending attachments.',
  'The selected model does not support image attachments.',
  'The selected model does not support document attachments.'
]);

/** The attachment errors that name the offending file are user copy already. */
const USER_FACING_PATTERNS = [/ is not a supported attachment type\.$/, / exceeds the attachment size limit\.$/];

function getErrorName(error: unknown) {
  if (error == null || typeof error !== 'object') {
    return '';
  }

  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}

/**
 * The classifier's code is what the renderer can branch on, but a raw `code`
 * (`ENOENT`, `SQLITE_CONSTRAINT`) is the more specific fact when there is one.
 */
function getErrorCode(error: unknown) {
  const own = error != null && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof own === 'string' && own ? own : normalizeError(error).code;
}

/** Stopping a generation is something the user did, not something that failed. */
export function isCancellation(error: unknown) {
  return normalizeError(error).code === 'aborted';
}

export function toUserFacingMessage(error: unknown): string {
  const normalized = normalizeError(error);
  const raw = normalized.message.trim();

  // Everything the classifier recognised — auth, credits, rate limits, timeouts,
  // aborts — already carries copy written for exactly this purpose.
  if (normalized.code !== 'unknown_error' && normalized.code !== 'provider_error') {
    return raw || GENERIC_MESSAGE;
  }

  if (USER_FACING_ERROR_NAMES.has(getErrorName(error))) {
    return raw || GENERIC_MESSAGE;
  }

  const replacement =
    REPLACEMENTS.get(raw) ?? PATTERN_REPLACEMENTS.find(({ pattern }) => pattern.test(raw))?.message;
  if (replacement) {
    return replacement;
  }

  if (USER_FACING_MESSAGES.has(raw) || USER_FACING_PATTERNS.some((pattern) => pattern.test(raw))) {
    return raw;
  }

  // `provider_error` is the provider describing its own refusal, which is worth
  // showing; `unknown_error` is us, and anything unlisted is an invariant the
  // user can do nothing with.
  if (normalized.code === 'provider_error' && raw) {
    return raw;
  }

  return GENERIC_MESSAGE;
}

function createUserFacingError(message: string, code: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

type IpcHandler = (...args: never[]) => unknown;

/**
 * Wrap an `ipcMain.handle` callback so the renderer only ever sees copy meant
 * for a person, while the main process keeps the error it was given.
 */
export function withUserFacingErrors<T extends IpcHandler>(channel: string, handler: T): T {
  const wrapped = async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (error) {
      const code = getErrorCode(error);

      if (isCancellation(error)) {
        logger.info('ipc.handler_cancelled', { channel });
        throw createUserFacingError(toUserFacingMessage(error), code);
      }

      logger.error('ipc.handler_failed', { channel, code, error });
      throw createUserFacingError(toUserFacingMessage(error), code);
    }
  };

  return wrapped as unknown as T;
}
