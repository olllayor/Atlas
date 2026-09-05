/**
 * Terminal-selection → composer context block, ported from t3code's
 * `lib/terminalContext.ts`. Selection remains the *explicit* channel — a
 * fenced `<terminal_context>` block appended after the prompt, never an
 * automatic injection. Since the C7 read-back tool (`terminal_read`) the
 * agent can also snapshot the conversation's terminal on its own, but only
 * as a bounded, ANSI-stripped, write-free view; this block is how the user
 * curates exactly what the model should look at.
 */

const CONTEXT_BLOCK_OPEN = '<terminal_context>';
const CONTEXT_BLOCK_CLOSE = '</terminal_context>';
/** Cap per block; a runaway `cat` dump should not eat the context window. */
const MAX_SELECTION_CHARS = 8_000;

export function buildTerminalContextBlock(input: {
  /** Shell label as shown in the dock (`zsh`, `pwsh`…). */
  shell?: string;
  selection: string;
}): string {
  const trimmed = input.selection.trim();
  if (!trimmed) return '';

  const clipped =
    trimmed.length > MAX_SELECTION_CHARS
      ? `${trimmed.slice(0, MAX_SELECTION_CHARS)}\n… (truncated)`
      : trimmed;
  const shell = input.shell?.trim() || 'terminal';
  const lines = clipped
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

  return `${CONTEXT_BLOCK_OPEN}\n- ${shell}:\n${lines}\n${CONTEXT_BLOCK_CLOSE}`;
}

/** True when the composer text already carries this selection's block. */
export function composerHasTerminalContext(composerText: string): boolean {
  return composerText.includes(CONTEXT_BLOCK_OPEN) && composerText.includes(CONTEXT_BLOCK_CLOSE);
}

/**
 * Transcript display strips the machinery back out — the user typed a prompt,
 * not XML. Returns the prompt with every terminal-context block removed.
 */
export function stripTerminalContextBlocks(messageText: string): string {
  return messageText
    .replace(new RegExp(`\\n?${CONTEXT_BLOCK_OPEN}[\\s\\S]*?${CONTEXT_BLOCK_CLOSE}`, 'g'), '')
    .replace(/\s+$/, '');
}
