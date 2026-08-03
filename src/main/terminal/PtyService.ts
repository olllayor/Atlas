import { createRequire } from 'node:module';
import { homedir } from 'node:os';

import type { IPty } from 'node-pty';

import type { TerminalOutputKind } from '../../shared/contracts';
import type { TerminalHistoryRepo } from '../db/repositories/terminalHistoryRepo';

/**
 * One shell per conversation, for the workbench's Terminal panel.
 *
 * The agent's `bash` tool keeps running through `runCommand()` with its own
 * approval gate — this PTY is the *user's* shell, and the agent only ever
 * writes echo lines into it (never input). Mixing the two would mean an
 * approval-gated command could be smuggled in as terminal input.
 *
 * Deliberately not sandboxed, for the same reason: the user is not the
 * adversary the OS sandbox exists to contain. Confining their own login shell
 * would break it and protect nothing.
 *
 * Output is ephemeral: the scrollback lives in the renderer's xterm instance
 * and dies with it. Only the command line is persisted, to `terminal_history`.
 */

export type PtySessionEmit = (payload: {
  conversationId: string;
  data: string;
  kind: TerminalOutputKind;
}) => void;

type PtySession = {
  pty: IPty;
  cwd: string;
  /**
   * Everything written since spawn, capped. A panel that mounts after the
   * shell started (tab switch, conversation switch) would otherwise show an
   * empty screen attached to a live shell.
   */
  scrollback: string;
  /** Bytes typed since the last Enter, for history. */
  pendingInput: string;
  exited: boolean;
};

const MAX_SCROLLBACK_CHARS = 200_000;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

const requireFromHere = createRequire(import.meta.url);

function defaultShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

export class PtyService {
  private readonly sessions = new Map<string, PtySession>();

  constructor(
    private readonly emit: PtySessionEmit,
    private readonly history: TerminalHistoryRepo,
  ) {}

  /**
   * Spawns the conversation's shell, or returns the running one.
   *
   * Re-calling with a different `cwd` (the user re-attached the project) kills
   * the old shell rather than leaving a terminal rooted in a folder the rest
   * of the app has stopped talking about.
   */
  start(conversationId: string, cwd: string | null, cols?: number, rows?: number) {
    const targetCwd = cwd ?? homedir();
    const existing = this.sessions.get(conversationId);

    if (existing && !existing.exited) {
      if (existing.cwd === targetCwd) {
        return { cwd: existing.cwd, scrollback: existing.scrollback, reused: true };
      }
      this.kill(conversationId);
    }

    // Required lazily: node-pty is a native module, and a broken rebuild must
    // fail the one panel that needs it rather than the whole main process.
    const { spawn } = requireFromHere('node-pty') as typeof import('node-pty');

    const pty = spawn(defaultShell(), process.platform === 'win32' ? [] : ['-l'], {
      name: 'xterm-256color',
      cols: cols ?? DEFAULT_COLS,
      rows: rows ?? DEFAULT_ROWS,
      cwd: targetCwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });

    const session: PtySession = {
      pty,
      cwd: targetCwd,
      scrollback: '',
      pendingInput: '',
      exited: false,
    };
    this.sessions.set(conversationId, session);

    pty.onData((data) => {
      this.append(session, data);
      this.emit({ conversationId, data, kind: 'stdout' });
    });

    pty.onExit(({ exitCode }) => {
      session.exited = true;
      const notice = `\r\n[process exited with code ${exitCode}]\r\n`;
      this.append(session, notice);
      this.emit({ conversationId, data: notice, kind: 'exit' });
    });

    return { cwd: targetCwd, scrollback: '', reused: false };
  }

  write(conversationId: string, data: string) {
    const session = this.sessions.get(conversationId);
    if (!session || session.exited) {
      return;
    }

    // Reconstruct the typed line so history holds commands rather than
    // keystrokes. Terminal editing beyond backspace (arrows, ^U) is left to
    // the shell; the worst case is a history entry that reads slightly off,
    // never a wrong command being run.
    for (const char of data) {
      if (char === '\r' || char === '\n') {
        const command = session.pendingInput.trim();
        session.pendingInput = '';
        if (command) {
          try {
            this.history.add({ conversationId, command, exitCode: null });
          } catch (err) {
            console.warn('[PtyService] failed to record command:', err);
          }
        }
      } else if (char === '\x7f' || char === '\b') {
        session.pendingInput = session.pendingInput.slice(0, -1);
      } else if (char === '\x03' || char === '\x15') {
        session.pendingInput = '';
      } else if (char >= ' ') {
        session.pendingInput += char;
      }
    }

    session.pty.write(data);
  }

  resize(conversationId: string, cols: number, rows: number) {
    const session = this.sessions.get(conversationId);
    if (!session || session.exited) {
      return;
    }

    // node-pty throws on a zero or negative dimension, which a hidden panel
    // measuring itself will happily report.
    const safeCols = Math.max(1, Math.floor(cols) || DEFAULT_COLS);
    const safeRows = Math.max(1, Math.floor(rows) || DEFAULT_ROWS);

    try {
      session.pty.resize(safeCols, safeRows);
    } catch (err) {
      console.warn('[PtyService] resize failed:', err);
    }
  }

  /**
   * The agent's command bridge: display-only. Nothing here reaches the shell's
   * stdin, so an echoed line can never execute.
   */
  echoAgentCommand(conversationId: string, command: string, exitCode: number | null) {
    const session = this.sessions.get(conversationId);
    if (!session) {
      return;
    }

    const status = exitCode == null ? '' : exitCode === 0 ? '' : ` (exit ${exitCode})`;
    // Dim (SGR 2), per the reference's recessive agent rows.
    const line = `\x1b[2m› ${command}${status}\x1b[0m\r\n`;
    this.append(session, line);
    this.emit({ conversationId, data: line, kind: 'agent' });
  }

  kill(conversationId: string) {
    const session = this.sessions.get(conversationId);
    if (!session) {
      return;
    }

    try {
      session.pty.kill();
    } catch (err) {
      console.warn('[PtyService] kill failed:', err);
    }

    this.sessions.delete(conversationId);
  }

  disposeAll() {
    for (const conversationId of [...this.sessions.keys()]) {
      this.kill(conversationId);
    }
  }

  private append(session: PtySession, data: string) {
    const next = session.scrollback + data;
    session.scrollback =
      next.length > MAX_SCROLLBACK_CHARS ? next.slice(next.length - MAX_SCROLLBACK_CHARS) : next;
  }
}
