/**
 * Naming a plugin, and optionally one of its skills, from the composer.
 *
 * `@github` says "this turn is about GitHub". `@github pr-review` says which
 * part of it. Both are explicit user intent, and that is what makes this
 * different from every other way a plugin becomes reachable:
 *
 * - **It resolves before the turn starts.** A turn's tool set is computed once,
 *   ahead of the stream, so `load_skill` activating a server mid-turn can only
 *   take effect on the *next* message. A mention is read off the user's text
 *   before any of that happens, so an `@`-named plugin's servers are connected
 *   and its tools offered on the same turn. This is the one activation route
 *   with no round trip.
 * - **It reaches skills the model may not choose.** A skill whose sidecar sets
 *   `allow_implicit_invocation: false` is deliberately absent from the prompt
 *   index — it exists to be asked for by name. Without this syntax there was no
 *   way to ask.
 * - **It narrows rather than widens.** Naming a plugin scopes the turn to it,
 *   which is the opposite of what installing more plugins normally does to a
 *   context window.
 *
 * Pure, and parses against a catalogue passed in rather than a global: the
 * renderer has the installed list from `plugins.list()` and the main process has
 * the registry, and both must agree on what a given message meant. A parser
 * that reached for state would let them disagree.
 */

export const PLUGIN_MENTION_TRIGGER = '@';

/** What the composer knows about one installed plugin, for matching and display. */
export type PluginMentionEntry = {
  name: string;
  description: string;
  /** Skill names, unqualified. Includes skills withheld from the prompt index. */
  skills: readonly string[];
  /** False when the plugin is installed but switched off or revoked. */
  available: boolean;
  /** Why it is unavailable, shown in the picker so the row is not a dead end. */
  unavailableReason?: string;
};

/** A resolved `@plugin` or `@plugin skill` in a message. */
export type PluginMentionTarget = {
  plugin: string;
  /** The named skill, or `null` when the mention named only the plugin. */
  skill: string | null;
};

/**
 * `@` must start a word.
 *
 * The same rule the Sites mention uses, and for the same reason: without it an
 * email address, a decorator in a pasted diff, or a handle inside a code fence
 * would silently scope someone's turn to a plugin.
 */
function startsWord(text: string, index: number): boolean {
  const preceding = index === 0 ? '' : text[index - 1];

  return !preceding || !/[\w@]/.test(preceding);
}

/** Plugin and skill names are lowercase-comparable; nothing else is normalised. */
function eq(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Every plugin named in a message, with the skill each one named.
 *
 * Resolved against the catalogue rather than by shape, because `@github` and
 * `@github pr-review` are indistinguishable syntactically — the second word is
 * a skill only if that plugin actually has one by that name. `@github fix this
 * bug` names the plugin and no skill, which is the common case and must not
 * turn "fix" into a failed skill lookup.
 */
export function parsePluginMentions(
  text: string,
  catalog: readonly PluginMentionEntry[]
): PluginMentionTarget[] {
  if (!text || catalog.length === 0) {
    return [];
  }

  const found: PluginMentionTarget[] = [];

  // Longest name first, so `@github-actions` is not matched as `@github`
  // followed by the stray word `-actions`.
  const byLength = [...catalog].sort((left, right) => right.name.length - left.name.length);

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== PLUGIN_MENTION_TRIGGER || !startsWord(text, index)) {
      continue;
    }

    const rest = text.slice(index + 1);
    const entry = byLength.find(
      (candidate) =>
        rest.length >= candidate.name.length &&
        eq(rest.slice(0, candidate.name.length), candidate.name) &&
        // A plugin name must end at a word boundary, or `@git` would match
        // inside `@github`.
        !/[\w-]/.test(rest[candidate.name.length] ?? '')
    );

    if (!entry) {
      continue;
    }

    const after = rest.slice(entry.name.length);
    const skillMatch = /^[ \t]+([\w.-]+)/.exec(after);
    const named = skillMatch?.[1];
    const skill = named ? (entry.skills.find((candidate) => eq(candidate, named)) ?? null) : null;

    // Deduplicated on the pair: `@github` twice is one activation, but
    // `@github a` and `@github b` are two distinct requests.
    const already = found.some((target) => eq(target.plugin, entry.name) && target.skill === skill);

    if (!already) {
      found.push({ plugin: entry.name, skill });
    }

    index += entry.name.length;
  }

  return found;
}

/** An in-progress `@…` at the caret, split into its plugin and skill halves. */
export type PluginMentionQuery = {
  /** Text typed after the `@`, up to the first space. */
  pluginQuery: string;
  /**
   * Text typed after a complete plugin name and a space, when there is one.
   *
   * `null` while the user is still typing the plugin. Non-null — possibly the
   * empty string — once a known plugin has been named, which is the moment the
   * picker should switch from listing plugins to listing that plugin's skills.
   */
  skillQuery: string | null;
  /** The plugin the skill half belongs to, when `skillQuery` is non-null. */
  plugin: PluginMentionEntry | null;
  start: number;
  end: number;
};

export function matchPluginMentionQuery(
  text: string,
  caret: number,
  catalog: readonly PluginMentionEntry[]
): PluginMentionQuery | null {
  if (caret < 0 || caret > text.length) {
    return null;
  }

  const before = text.slice(0, caret);
  const triggerIndex = before.lastIndexOf(PLUGIN_MENTION_TRIGGER);

  if (triggerIndex === -1 || !startsWord(before, triggerIndex)) {
    return null;
  }

  const typed = before.slice(triggerIndex + 1);
  const spaceIndex = typed.search(/[ \t]/);

  if (spaceIndex === -1) {
    // Still on the plugin half. A newline ends the attempt entirely.
    return /\n/.test(typed)
      ? null
      : { pluginQuery: typed, skillQuery: null, plugin: null, start: triggerIndex, end: caret };
  }

  const name = typed.slice(0, spaceIndex);
  const plugin = catalog.find((candidate) => eq(candidate.name, name)) ?? null;
  const rest = typed.slice(spaceIndex + 1);

  // Only a *known* plugin opens the skill half, and only while the remainder is
  // still one word. Otherwise `@github fix the bug` would keep the picker open
  // across the whole sentence.
  if (!plugin || /[\s]/.test(rest)) {
    return null;
  }

  return { pluginQuery: name, skillQuery: rest, plugin, start: triggerIndex, end: caret };
}

export type PluginMentionSuggestion =
  | { kind: 'plugin'; entry: PluginMentionEntry }
  | { kind: 'skill'; entry: PluginMentionEntry; skill: string };

/**
 * What to offer for an in-progress mention.
 *
 * Unavailable plugins are listed rather than hidden, with their reason. A
 * disabled plugin missing from the picker reads as "not installed", and the
 * user goes looking in the browser for something that is already there.
 */
export function suggestPluginMentions(
  query: PluginMentionQuery,
  catalog: readonly PluginMentionEntry[]
): PluginMentionSuggestion[] {
  if (query.skillQuery != null && query.plugin) {
    const needle = query.skillQuery.trim().toLowerCase();
    const plugin = query.plugin;

    return plugin.skills
      .filter((skill) => !needle || skill.toLowerCase().includes(needle))
      .map((skill) => ({ kind: 'skill', entry: plugin, skill }));
  }

  const needle = query.pluginQuery.trim().toLowerCase();

  return catalog
    .filter((entry) => {
      if (!needle) {
        return true;
      }

      return `${entry.name} ${entry.description}`.toLowerCase().includes(needle);
    })
    .map((entry) => ({ kind: 'plugin', entry }));
}

/** Replaces the in-progress mention with the chosen token. */
export function applyPluginMention(
  text: string,
  query: PluginMentionQuery,
  suggestion: PluginMentionSuggestion
): { text: string; caret: number } {
  // A plugin is completed without a trailing space: the next keystroke is often
  // a space that opens the skill picker, and inserting one here would fire it
  // before the user asked for it. A skill *is* the end of the mention, so it
  // gets the space.
  const token =
    suggestion.kind === 'plugin'
      ? `${PLUGIN_MENTION_TRIGGER}${suggestion.entry.name}`
      : `${PLUGIN_MENTION_TRIGGER}${suggestion.entry.name} ${suggestion.skill} `;

  return {
    text: `${text.slice(0, query.start)}${token}${text.slice(query.end)}`,
    caret: query.start + token.length
  };
}

/** How a resolved mention reads in the transcript, e.g. `@github pr-review`. */
export function describePluginMention(target: PluginMentionTarget): string {
  return target.skill
    ? `${PLUGIN_MENTION_TRIGGER}${target.plugin} ${target.skill}`
    : `${PLUGIN_MENTION_TRIGGER}${target.plugin}`;
}
