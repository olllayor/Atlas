/**
 * Session naming helpers, shared between the main process (which generates
 * titles) and tests. New conversations are created as `Session · <date>`;
 * anything still matching that shape has never been named — by the user or
 * by the generator — and is fair game for an automatic title.
 */

import { assistantCitationsToPlainText } from './citations';

export const PLACEHOLDER_SESSION_TITLE_PATTERN = /^Session · /;

export function isPlaceholderSessionTitle(title: string | null | undefined): boolean {
  return title != null && PLACEHOLDER_SESSION_TITLE_PATTERN.test(title);
}

export const SESSION_TITLE_MAX_LENGTH = 60;

/**
 * Model output → usable sidebar title. Models ignore instructions often
 * enough that every rule here exists because some model broke it: wrapping
 * quotes, a `Title:` prefix, markdown emphasis, multi-line answers,
 * trailing periods.
 */
export function sanitizeGeneratedTitle(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  let title = raw.trim();

  // First non-empty line only — some models append an explanation.
  title = title.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? '';

  // Leading labels like "Title:" / "Session name:".
  title = title.replace(/^(?:title|session(?: name)?|name)\s*[:\-\u2013]\s*/i, '');

  // Markdown emphasis and wrapping quotes/backticks.
  title = title.replace(/[*_`]/g, '');
  title = title.replace(/^["'\u201c\u201d\u2018\u2019]+/, '').replace(/["'\u201c\u201d\u2018\u2019]+$/, '');

  title = title.replace(/\s+/g, ' ').trim();

  // Trailing sentence punctuation reads wrong in a list of names.
  title = title.replace(/[.\u3002!?\u2026\s]+$/u, '');

  if (!title) {
    return null;
  }

  if (title.length > SESSION_TITLE_MAX_LENGTH) {
    // Cut on a word boundary where one exists reasonably close.
    const slice = title.slice(0, SESSION_TITLE_MAX_LENGTH);
    const lastSpace = slice.lastIndexOf(' ');
    title = (lastSpace > SESSION_TITLE_MAX_LENGTH * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd();
  }

  return title;
}

/**
 * Offline fallback: name a session from the user's opening message.
 *
 * Worse than a model-written title, far better than leaving the session as
 * `Session · <date>` because a provider was unreachable, rejected the
 * request, or answered with nothing usable. Deterministic and free.
 */
export function deriveTitleFromUserMessage(message: string | null | undefined): string | null {
  if (!message) {
    return null;
  }

  // Citations see quote text, never href bytes:
  let text = assistantCitationsToPlainText(message);

  // Fenced code and inline mentions make terrible titles; drop them before
  // taking the first sentence.
  text = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  if (!text) {
    return null;
  }

  // First sentence, when the message opens with one short enough to stand
  // on its own as a name.
  const sentenceEnd = text.search(/[.!?\u3002\uff01\uff1f]\s|[.!?\u3002\uff01\uff1f]$/u);
  if (sentenceEnd > 0 && sentenceEnd + 1 <= SESSION_TITLE_MAX_LENGTH) {
    text = text.slice(0, sentenceEnd + 1);
  }

  // Reuse the same normalization the model path gets: strips quotes,
  // trailing punctuation, and truncates on a word boundary.
  return sanitizeGeneratedTitle(text);
}
