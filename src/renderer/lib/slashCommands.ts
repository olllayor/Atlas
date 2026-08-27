/**
 * Built-in slash commands — the control surface of the composer (dsh's
 * command registry, scaled to t3code's three-inline-builtins size).
 *
 * These are *not* prompt text: a standalone `/name` draft is consumed before
 * send and executed as an action. Plugin template commands keep their existing
 * insert-as-text behavior; the two grammars coexist because they do different
 * jobs.
 */

export type BuiltinSlashCommand = {
  name: string;
  description: string;
};

export const BUILTIN_SLASH_COMMANDS: readonly BuiltinSlashCommand[] = [
  { name: 'compact', description: 'Compress older history on the next turn for context headroom' },
  { name: 'review', description: 'Open the review panel: diffs by scope, stage, revert, comment' },
  { name: 'fork', description: 'Copy this conversation into a new one' },
  { name: 'side', description: 'Open a side chat; run again to promote it into a normal conversation' },
  { name: 'goal', description: 'Set a persistent objective the agent keeps working toward (/goal pause · resume · clear)' },
  { name: 'model', description: 'Switch the model for this conversation' },
  { name: 'plan', description: 'Toggle between Work and Plan-style Code focus' },
];

/** `^/name` with word-boundary end — dsh's grammar, ASCII-only names. */
const COMMAND_LINE_PATTERN = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/;

/** A draft that is exactly a command invocation — consumed, never sent. */
const STANDALONE_PATTERN = /^\/([a-z][a-z0-9_-]*)\s*$/i;

export function matchCommandAtStart(draft: string): BuiltinSlashCommand | null {
  const match = COMMAND_LINE_PATTERN.exec(draft);
  if (!match) return null;
  return BUILTIN_SLASH_COMMANDS.find((command) => command.name === match[1]) ?? null;
}

/**
 * t3code's standalone-command parse (`composer-logic.ts:271`): a draft that
 * is exactly `/name` (case-insensitive, trailing spaces fine) is a control
 * action, not a message. Returns the matched command or null to send normally.
 */
export function parseStandaloneSlashCommand(
  draft: string
): BuiltinSlashCommand | null {
  // Column zero only: a command is a deliberate first keystroke, not a
  // mid-sentence token. Trailing whitespace is tolerated.
  if (!draft.startsWith('/')) return null;
  const match = STANDALONE_PATTERN.exec(draft.trimEnd());
  if (!match) return null;
  return BUILTIN_SLASH_COMMANDS.find((command) => command.name === match[1]?.toLowerCase()) ?? null;
}

/** Filter for the autocomplete popup as the user types after `/`. */
export function filterSlashCommands(query: string): BuiltinSlashCommand[] {
  const needle = query.toLowerCase();
  if (!needle) return [...BUILTIN_SLASH_COMMANDS];
  return BUILTIN_SLASH_COMMANDS.filter(
    (command) =>
      command.name.startsWith(needle) || command.description.toLowerCase().includes(needle)
  );
}

export type SlashInvocation = {
  name: string;
  /** Everything after the command word, verbatim (trimmed). Empty when bare. */
  args: string;
};

/**
 * The standalone parse with arguments: `/goal fix the flaky tests` is one
 * invocation whose args are the objective. Only built-ins that declare
 * `takesArgs` consume the rest of the line; every other command keeps the
 * exact-invocation grammar above, so `/compact now` still fails loudly
 * instead of silently swallowing "now".
 */
const ARG_TAKING_COMMANDS: ReadonlySet<string> = new Set(['goal']);

export function parseStandaloneCommandWithArgs(draft: string): SlashInvocation | null {
  if (!draft.startsWith('/')) return null;
  const trimmedEnd = draft.trimEnd();
  const match = /^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]+))?$/i.exec(trimmedEnd);
  if (!match) return null;
  const name = match[1]?.toLowerCase() ?? '';
  if (!BUILTIN_SLASH_COMMANDS.some((command) => command.name === name)) return null;
  const args = match[2]?.trim() ?? '';
  if (!ARG_TAKING_COMMANDS.has(name)) {
    // Non-arg command with trailing text is not a standalone invocation.
    return args ? null : { name, args: '' };
  }
  return { name, args };
}
