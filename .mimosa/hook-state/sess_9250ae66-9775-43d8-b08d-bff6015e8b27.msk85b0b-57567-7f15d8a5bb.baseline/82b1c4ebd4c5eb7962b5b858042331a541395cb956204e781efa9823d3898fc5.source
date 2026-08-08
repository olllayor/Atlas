import { expandCommandBody } from './plugins';

/**
 * Composer slash commands.
 *
 * A command is a prompt template a plugin ships and the user invokes by name.
 * Picking one **expands into the composer** rather than being sent as a token
 * the main process quietly rewrites later. That is the whole design:
 *
 * - The composer stays a plain controlled textarea, so nothing in the send path
 *   has to understand a richer document model — the same reasoning that keeps
 *   `@mentions` as literal text.
 * - What the user reads is what the model receives. A plugin's template is
 *   third-party text, and the honest place to review third-party text is in the
 *   box before pressing send, not in a transcript afterwards. This is why a
 *   command body needs none of the untrusted-source fencing a skill body gets.
 *
 * Pure, so the picker and the tests read the same rules.
 */

export const COMMAND_TRIGGER = '/';

export type CommandDefinition = {
  /** `<plugin>:<command>`, unique across bundles. */
  qualifiedName: string;
  pluginName: string;
  name: string;
  description: string;
  argumentHint: string;
};

export type CommandQuery = {
  /** The command name typed so far, empty right after the `/`. */
  query: string;
  /** Everything after the name, which becomes `$ARGUMENTS`. */
  args: string;
  /** Always 0 — see `matchCommandQuery`. */
  start: number;
  /** Index just past the whole invocation. */
  end: number;
};

/**
 * Detects an in-progress command, or `null`.
 *
 * Only ever matches a `/` in the **first column of an empty-so-far message**,
 * and that restriction is doing real work. A slash is the most common character
 * in ordinary prose that could be mistaken for a trigger — paths, URLs, dates,
 * `and/or` — and every one of those appears mid-line. Anchoring to the start
 * removes the entire class rather than trying to filter it.
 *
 * The popup stays open while arguments are typed, so `/review src/app.ts` keeps
 * showing what `review` will do instead of vanishing at the first space.
 */
export function matchCommandQuery(text: string, caret: number): CommandQuery | null {
  if (caret < 0 || caret > text.length || !text.startsWith(COMMAND_TRIGGER)) {
    return null;
  }

  // A newline means the message has become prose that merely begins with a
  // slash, and the user is no longer naming a command.
  if (text.includes('\n')) {
    return null;
  }

  const rest = text.slice(1);
  const separator = rest.search(/\s/);
  const query = separator === -1 ? rest : rest.slice(0, separator);

  // Only while the caret is still inside the invocation. Moving it back into an
  // already-expanded message must not reopen the picker.
  if (caret < 1) {
    return null;
  }

  return {
    query,
    args: separator === -1 ? '' : rest.slice(separator + 1),
    start: 0,
    end: text.length
  };
}

export function filterCommands(
  commands: readonly CommandDefinition[],
  query: string
): CommandDefinition[] {
  const normalized = query.trim().toLowerCase();

  const matches = normalized
    ? commands.filter((command) =>
        [command.name, command.pluginName, command.description]
          .join(' ')
          .toLowerCase()
          .includes(normalized)
      )
    : [...commands];

  // An exact name first, then names that start with what was typed. Someone who
  // has typed a whole command name means that one, whatever else also matches.
  return matches.sort((left, right) => rank(left, normalized) - rank(right, normalized));
}

function rank(command: CommandDefinition, query: string): number {
  if (!query) {
    return 0;
  }

  const name = command.name.toLowerCase();

  return name === query ? 0 : name.startsWith(query) ? 1 : 2;
}

/** The text a command occupies while being typed, e.g. `/review`. */
export function commandToken(command: CommandDefinition): string {
  return `${COMMAND_TRIGGER}${command.name}`;
}

/**
 * Replaces the invocation with the command's expanded body.
 *
 * The caret lands at the end, because the expansion is a draft: the point of
 * putting it in the composer is that it can be edited before it is sent.
 */
export function applyCommand(
  range: CommandQuery,
  body: string
): { text: string; caret: number } {
  const text = expandCommandBody(body, range.args);

  return { text, caret: text.length };
}
