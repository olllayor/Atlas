import type { ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';

import type { TerminalReadback } from './toolWorkspace';

/**
 * The agent's read-only window into the conversation's interactive terminal
 * (the user's shell, not the agent's bash sandbox).
 *
 * Write access stays impossible by construction: this module only ever calls
 * `TerminalReadback.snapshot`, which copies buffered output. There is no code
 * path from here to the PTY's stdin, so reading the screen can never inject
 * keystrokes — the same display-only boundary `echoAgentCommand` respects in
 * the other direction.
 */

const DEFAULT_MAX_CHARS = 8_000;
const MAX_SCROLL_CHARS = 20_000;

/** Strips ANSI escape sequences so the model sees text, not terminal codes. */
function stripAnsi(text: string): string {
  return text
    // CSI sequences: cursor movement, colors (SGR), erase, mode sets.
    .replace(/\x1b\[[0-9;:?]*[ -/]*[@-~]/g, '')
    // OSC sequences (window title, hyperlinks) up to BEL or ST.
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // Lone ESC-prefixed two-byte sequences.
    .replace(/\x1b[@-Z\\-_]/g, '');
}

export function createTerminalTools(readback: TerminalReadback, conversationId: string): ToolSet {
  return {
    terminal_read: tool({
      description:
        "Read recent output from this conversation's interactive terminal panel (the user's live shell). " +
        'Use it to check on a command the user ran themselves, or a long-running process they are watching. ' +
        'Returns the last N characters of visible screen text with ANSI styling removed. You cannot write to this terminal.',
      inputSchema: z.object({
        max_chars: z
          .number()
          .int()
          .min(200)
          .max(MAX_SCROLL_CHARS)
          .optional()
          .describe(`How much trailing output to return; defaults to ${DEFAULT_MAX_CHARS}`)
      }),
      execute: async ({ max_chars }) => {
        const snapshot = readback.snapshot(conversationId);
        if (!snapshot.cwd && !snapshot.alive) {
          return {
            alive: false,
            cwd: null,
            text: '(no terminal session has been started for this conversation)'
          };
        }
        const budget = max_chars ?? DEFAULT_MAX_CHARS;
        const visible = stripAnsi(snapshot.scrollback);
        const text = visible.length > budget ? visible.slice(visible.length - budget) : visible;
        return {
          alive: snapshot.alive,
          cwd: snapshot.cwd,
          text: text || '(terminal is empty)'
        };
      }
    })
  };
}
