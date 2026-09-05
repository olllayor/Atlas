/**
 * Terminal identity, shared by both processes.
 *
 * Ids are always chosen by the renderer and sent explicitly on every call.
 * Main never allocates one. That is what makes `start` idempotent: two panels
 * racing to attach to `term-2` both land on the same shell instead of each
 * spawning one and the second orphaning the first.
 */

/**
 * The conversation's first shell. The bottom dock owns it, the agent's
 * command echo lands in it, and `terminal_read` reads it — one terminal per
 * conversation is still the shape those three assume, and naming it here is
 * cheaper than teaching each of them to pick.
 */
export const PRIMARY_TERMINAL_ID = 'term-1';

const TERMINAL_ID_PATTERN = /^term-(\d+)$/;

export function isTerminalId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_ID_PATTERN.test(value);
}

/** The lowest unused `term-N`, so closing the middle tab reuses its number. */
export function nextTerminalId(existingIds: readonly string[]): string {
  const used = new Set(existingIds);
  let index = 1;
  while (used.has(`term-${index}`)) index += 1;
  return `term-${index}`;
}

/** Fallback label for an idle shell: what the tab reads before anything runs. */
export function terminalLabelFromId(terminalId: string): string {
  const ordinal = TERMINAL_ID_PATTERN.exec(terminalId)?.[1];
  return ordinal ? `Terminal ${ordinal}` : terminalId;
}
