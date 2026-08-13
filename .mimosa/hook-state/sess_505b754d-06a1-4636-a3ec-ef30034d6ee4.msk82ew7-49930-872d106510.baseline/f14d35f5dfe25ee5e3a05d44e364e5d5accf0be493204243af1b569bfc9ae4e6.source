/**
 * Composer mentions.
 *
 * A mention is an explicit, user-typed opt-in to a capability: `@Sites` tells
 * the turn to load the Sites toolset. Without it those tools are not offered to
 * the model at all, so the assistant cannot wander into building a site when
 * you asked for a snippet.
 *
 * Everything here is pure so both the renderer autocomplete and the main
 * process gate read the same rules.
 */

export type MentionId = 'sites';

export type MentionDefinition = {
  id: MentionId;
  /** Canonical casing inserted into the composer, without the leading `@`. */
  label: string;
  description: string;
  /** Extra search terms for the autocomplete. */
  keywords: readonly string[];
};

export const MENTION_DEFINITIONS: readonly MentionDefinition[] = [
  {
    id: 'sites',
    label: 'Sites',
    description: 'Build, preview, and publish a multi-file static site',
    keywords: ['site', 'website', 'page', 'landing', 'html', 'publish'],
  },
];

export const MENTION_TRIGGER = '@';

export function getMentionDefinition(id: MentionId): MentionDefinition | null {
  return MENTION_DEFINITIONS.find((definition) => definition.id === id) ?? null;
}

/** The text a mention occupies in the composer, e.g. `@Sites`. */
export function getMentionToken(definition: MentionDefinition): string {
  return `${MENTION_TRIGGER}${definition.label}`;
}

/**
 * A mention only counts when `@` starts a word — so an email address or a
 * decorator in a pasted code block never silently enables a toolset.
 */
function buildMentionPattern(label: string): RegExp {
  return new RegExp(`(^|[^\\w@])${MENTION_TRIGGER}${label}\\b`, 'i');
}

export function parseMentions(text: string): MentionId[] {
  if (!text) return [];

  const found: MentionId[] = [];
  for (const definition of MENTION_DEFINITIONS) {
    if (buildMentionPattern(definition.label).test(text)) {
      found.push(definition.id);
    }
  }
  return found;
}

export function hasMention(text: string, id: MentionId): boolean {
  return parseMentions(text).includes(id);
}

export type MentionQuery = {
  /** Text typed after the `@`, may be empty right after the trigger. */
  query: string;
  /** Index of the `@` in the source text. */
  start: number;
  /** Index just past the typed query. */
  end: number;
};

/**
 * Detect an in-progress mention at the caret, or null when the caret is not
 * inside one. Used to drive the autocomplete popup.
 */
export function matchMentionQuery(text: string, caret: number): MentionQuery | null {
  if (caret < 0 || caret > text.length) return null;

  const before = text.slice(0, caret);
  const triggerIndex = before.lastIndexOf(MENTION_TRIGGER);
  if (triggerIndex === -1) return null;

  // The trigger must start a word, matching parseMentions.
  const preceding = triggerIndex === 0 ? '' : before[triggerIndex - 1];
  if (preceding && /[\w@]/.test(preceding)) return null;

  const query = before.slice(triggerIndex + 1);
  // A mention is a single word; whitespace ends the attempt.
  if (/\s/.test(query)) return null;

  return { query, start: triggerIndex, end: caret };
}

export function filterMentions(query: string): MentionDefinition[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...MENTION_DEFINITIONS];

  return MENTION_DEFINITIONS.filter((definition) => {
    const haystack = [definition.label, definition.id, ...definition.keywords].join(' ').toLowerCase();
    return haystack.includes(normalized);
  });
}

/** Replace an in-progress mention with the completed token. */
export function applyMention(
  text: string,
  range: MentionQuery,
  definition: MentionDefinition
): { text: string; caret: number } {
  const token = `${getMentionToken(definition)} `;
  const next = `${text.slice(0, range.start)}${token}${text.slice(range.end)}`;
  return { text: next, caret: range.start + token.length };
}
