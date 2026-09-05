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
export function deriveTitleFromUserMessage(message: string | null | undefined): string | null {  if (!message) {
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

/**
 * Durable title prompts, ported from t3code PR #5357
 * ("fix(server): generate durable thread titles").
 *
 * The old prompt asked for a summary of the request, which produced titles
 * that restated the first message verbatim ("Review PR 123", "Fix login bug
 * please"). The durable prompt instead asks for the subject and outcome so
 * the title still identifies the thread weeks later.
 *
 * Atlas keeps its plain-text reply contract (see `sanitizeGeneratedTitle`)
 * rather than t3code's `{"title": ...}` JSON shape: the title call runs
 * through the normal provider adapter, and every model already answers the
 * "reply with the title only" form.
 */

export interface ThreadTitlePrompt {
  readonly system: string;
  readonly message: string;
}

const TITLE_GUIDANCE = [
  'Before answering, silently reduce the request to:',
  '- Subject: What system, feature, or problem is this really about?',
  '- Outcome: What does the user ultimately want to understand or change?',
  '- Incidental instructions: What only describes how the agent should do the work?',
  '',
  'Title the subject and outcome. Discard incidental instructions.',
  ''
].join('\n');

const TITLE_EDITORIAL_RULES = [
  '3-8 words, fewer than 40 characters.',
  'Use a compact noun phrase or clear action phrase.',
  'Capture the umbrella goal when the request lists several symptoms or steps.',
  'Name the product change, not the mock, plan, report, branch, or PR used to produce it.',
  'Models, subagents, tools, output formats, and monitoring instructions do not belong in the title unless they are themselves the topic.',
  'For reviews, name what is being reviewed and the relevant concern. Avoid generic titles such as "Review PR 123" when context reveals the subject.',
  'For research, name the question domain rather than the requested research process.',
  'Do not claim the work is complete.',
  "Do not copy and truncate the user's message.",
  'Avoid project names already visible in the UI, quotes, labels, filler, and trailing punctuation.'
];

/** Prompt for the automatic title after the opening exchange. */
export function buildThreadTitlePrompt(input: {
  readonly userMessage: string;
  readonly assistantReply: string;
}): ThreadTitlePrompt {
  const system = [
    'Generate a title that will help the user recognize this chat session weeks later.',
    'Reply with the title only: 3-8 words, no quotes, no trailing punctuation, same language as the conversation.',
    '',
    TITLE_GUIDANCE,
    'Editorial rules:',
    ...TITLE_EDITORIAL_RULES.map((rule) => `- ${rule}`)
  ].join('\n');

  return {
    system,
    message: `User message:\n${input.userMessage}\n\nAssistant reply:\n${input.assistantReply || '(none)'}`
  };
}

/** Prompt for an explicit regeneration over the whole thread. */
export function buildThreadTitleRegenerationPrompt(input: {
  readonly thread: string;
  readonly previousTitle: string;
}): ThreadTitlePrompt {
  const system = [
    'Generate a new title that will help the user recognize this chat session weeks later.',
    `The previous title was ${JSON.stringify(input.previousTitle)}.`,
    '',
    TITLE_GUIDANCE,
    'Editorial rules:',
    ...TITLE_EDITORIAL_RULES.map((rule) => `- ${rule}`),
    '- Capture the current durable subject and outcome across the whole thread, not merely its initial request or latest step.',
    '- Return a different title from the previous title.'
  ].join('\n');

  return { system, message: `Thread contents:\n${input.thread}` };
}

export interface ThreadDigestEntry {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

const DIGEST_OPENING_CHARS = 600;
const DIGEST_TAIL_CHARS = 400;
const DIGEST_TAIL_ENTRIES = 4;

/**
 * Bounded whole-thread digest for title regeneration: the opening exchange
 * plus the tail, with a marker where the middle was omitted. Short threads
 * pass through unmarked.
 */
export function buildThreadTitleDigest(entries: readonly ThreadDigestEntry[]): string {
  const cleaned = entries
    .map((entry) => ({ role: entry.role, text: entry.text.trim() }))
    .filter((entry) => entry.text.length > 0);
  if (cleaned.length === 0) {
    return '';
  }

  const render = (entry: { role: 'user' | 'assistant'; text: string }, budget: number) =>
    `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.text.slice(0, budget).trim()}`;

  if (cleaned.length <= 2 + DIGEST_TAIL_ENTRIES) {
    return cleaned
      .map((entry, index) => render(entry, index < 2 ? DIGEST_OPENING_CHARS : DIGEST_TAIL_CHARS))
      .join('\n\n');
  }

  const head = cleaned.slice(0, 2).map((entry) => render(entry, DIGEST_OPENING_CHARS));
  const tail = cleaned
    .slice(-DIGEST_TAIL_ENTRIES)
    .map((entry) => render(entry, DIGEST_TAIL_CHARS));
  return [...head, '[earlier messages omitted]', ...tail].join('\n\n');
}
