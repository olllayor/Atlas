import { createRequire } from 'node:module';
import { homedir } from 'node:os';

import type { IPty } from 'node-pty';

import type {
  TerminalMetadataEvent,
  TerminalOutputKind,
  TerminalSummary,
} from '../../shared/contracts';
import { PRIMARY_TERMINAL_ID, terminalLabelFromId } from '../../shared/terminalIds';
import type { TerminalHistoryRepo } from '../db/repositories/terminalHistoryRepo';
import {
  EMPTY_PROCESS_TABLE,
  inspectSubprocess,
  probeProcessTree,
  type ProcessTable,
} from './processTree';

/**
 * The user's shells, keyed by conversation *and* terminal id.
 *
 * A conversation can hold several: the bottom dock owns `term-1` and each
 * terminal surface in the right panel owns one of its own. Ids come from the
 * renderer on every call and are never allocated here, which is what makes
 * `start` idempotent — two panels attaching to the same id share one shell
 * instead of racing to spawn two.
 *
 * The agent's `bash` tool keeps running through `runCommand()` with its own
 * approval gate — these PTYs are the *user's* shells, and the agent only ever
 * writes echo lines into one (never input). Mixing the two would mean an
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
  terminalId: string;
  data: string;
  kind: TerminalOutputKind;
}) => void;

export type PtyMetadataEmit = (event: TerminalMetadataEvent) => void;

type PtySession = {
  conversationId: string;
  terminalId: string;
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
  exitCode: number | null;
  /** Last answer from the process-tree probe, and the label derived from it. */
  hasRunningSubprocess: boolean;
  label: string;
};

const MAX_SCROLLBACK_CHARS = 200_000;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
/**
 * Fast enough that a tab renames itself while the user is still looking at it,
 * slow enough that one `ps` per tick is not worth thinking about. The poll only
 * runs while a panel is watching *and* a shell is alive.
 */
const LABEL_POLL_INTERVAL_MS = 1_000;

const requireFromHere = createRequire(import.meta.url);

function sessionKey(conversationId: string, terminalId: string) {
  // Joined on an escape that neither half can contain, written explicitly:
  // a literal separator here once landed in the source as a raw NUL byte,
  // which every reader saw as nothing and git saw as a binary file.
  return `${conversationId}\u0000${terminalId}`;
}

function defaultShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

export class PtyService {
  private readonly sessions = new Map<string, PtySession>();
  /** Renderers with a terminal panel mounted. The label poll runs only for them. */
  private watchers = 0;
  private labelTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly emit: PtySessionEmit,
    private readonly history: TerminalHistoryRepo,
    private readonly emitMetadata: PtyMetadataEmit = () => {}
  ) {}

  /**
   * Spawns the named shell, or returns the running one.
   *
   * Re-calling with a different `cwd` (the user re-attached the project) kills
   * the old shell rather than leaving a terminal rooted in a folder the rest
   * of the app has stopped talking about.
   */
  start(conversationId: string, terminalId: string, cwd: string | null, cols?: number, rows?: number) {
    const targetCwd = cwd ?? homedir();
    const key = sessionKey(conversationId, terminalId);
    const existing = this.sessions.get(key);

    if (existing && !existing.exited) {
      if (existing.cwd === targetCwd) {
        return { cwd: existing.cwd, scrollback: existing.scrollback, reused: true };
      }
      this.kill(conversationId, terminalId);
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
      conversationId,
      terminalId,
      pty,
      cwd: targetCwd,
      scrollback: '',
      pendingInput: '',
      exited: false,
      exitCode: null,
      hasRunningSubprocess: false,
      label: terminalLabelFromId(terminalId),
    };
    this.sessions.set(key, session);

    pty.onData((data) => {
      this.append(session, data);
      this.emit({ conversationId, terminalId, data, kind: 'stdout' });
    });

    pty.onExit(({ exitCode }) => {
      session.exited = true;
      session.exitCode = exitCode;
      session.hasRunningSubprocess = false;
      session.label = terminalLabelFromId(terminalId);
      const notice = `\r\n[process exited with code ${exitCode}]\r\n`;
      this.append(session, notice);
      this.emit({ conversationId, terminalId, data: notice, kind: 'exit' });
      // The tab has to stop claiming the shell is alive even if nothing is
      // polling labels at that moment.
      this.emitMetadata({ type: 'upsert', terminal: summarize(session) });
      this.syncLabelPolling();
    });

    this.emitMetadata({ type: 'upsert', terminal: summarize(session) });
    this.syncLabelPolling();

    return { cwd: targetCwd, scrollback: '', reused: false };
  }

  write(conversationId: string, terminalId: string, data: string) {
    const session = this.sessions.get(sessionKey(conversationId, terminalId));
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

  resize(conversationId: string, terminalId: string, cols: number, rows: number) {
    const session = this.sessions.get(sessionKey(conversationId, terminalId));
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

  /** Every shell a conversation owns, oldest first. */
  list(conversationId: string): TerminalSummary[] {
    const summaries: TerminalSummary[] = [];
    for (const session of this.sessions.values()) {
      if (session.conversationId === conversationId) summaries.push(summarize(session));
    }
    return summaries;
  }

  /**
   * The agent's command bridge: display-only. Nothing here reaches the shell's
   * stdin, so an echoed line can never execute. It lands in the conversation's
   * primary shell — the one the dock shows — because that is the terminal the
   * user is being kept in step with.
   */
  echoAgentCommand(conversationId: string, command: string, exitCode: number | null) {
    const session = this.sessions.get(sessionKey(conversationId, PRIMARY_TERMINAL_ID));
    if (!session) {
      return;
    }

    const status = exitCode == null ? '' : exitCode === 0 ? '' : ` (exit ${exitCode})`;
    // Dim (SGR 2), per the reference's recessive agent rows.
    const line = `\x1b[2m› ${command}${status}\x1b[0m\r\n`;
    this.append(session, line);
    this.emit({
      conversationId,
      terminalId: PRIMARY_TERMINAL_ID,
      data: line,
      kind: 'agent',
    });
  }

  /**
   * Read-only view for the agent's `terminal_read` tool: liveness, spawn cwd,
   * and the capped scrollback buffer of the conversation's primary shell. No
   * handle to stdin leaves this class, so a reader can observe but never drive
   * the terminal.
   */
  snapshot(conversationId: string): { alive: boolean; cwd: string | null; scrollback: string } {
    const session = this.sessions.get(sessionKey(conversationId, PRIMARY_TERMINAL_ID));
    if (!session) {
      return { alive: false, cwd: null, scrollback: '' };
    }
    return {
      alive: !session.exited,
      cwd: session.cwd,
      scrollback: session.scrollback,
    };
  }

  kill(conversationId: string, terminalId: string) {
    const key = sessionKey(conversationId, terminalId);
    const session = this.sessions.get(key);
    if (!session) {
      return;
    }

    try {
      session.pty.kill();
    } catch (err) {
      console.warn('[PtyService] kill failed:', err);
    }

    this.sessions.delete(key);
    this.emitMetadata({ type: 'remove', conversationId, terminalId });
    this.syncLabelPolling();
  }

  /** Every shell the conversation owns; used when the conversation is deleted. */
  killConversation(conversationId: string) {
    for (const session of [...this.sessions.values()]) {
      if (session.conversationId === conversationId) {
        this.kill(conversationId, session.terminalId);
      }
    }
  }

  disposeAll() {
    for (const session of [...this.sessions.values()]) {
      this.kill(session.conversationId, session.terminalId);
    }
    this.stopLabelPolling();
  }

  /**
   * A renderer with a terminal panel mounted. Labels cost a `ps` per second,
   * so nothing is spent while every panel is closed.
   */
  addWatcher() {
    this.watchers += 1;
    this.syncLabelPolling();
  }

  removeWatcher() {
    this.watchers = Math.max(0, this.watchers - 1);
    this.syncLabelPolling();
  }

  private liveSessions() {
    return [...this.sessions.values()].filter((session) => !session.exited);
  }

  private syncLabelPolling() {
    const wanted = this.watchers > 0 && this.liveSessions().length > 0;
    if (wanted && !this.labelTimer) {
      this.labelTimer = setInterval(() => {
        void this.refreshLabels();
      }, LABEL_POLL_INTERVAL_MS);
      // The poll must never be the reason the process stays up.
      this.labelTimer.unref?.();
      void this.refreshLabels();
      return;
    }
    if (!wanted) this.stopLabelPolling();
  }

  private stopLabelPolling() {
    if (!this.labelTimer) return;
    clearInterval(this.labelTimer);
    this.labelTimer = null;
  }

  /**
   * One process table for every live shell, and an event only for the tabs
   * whose name actually moved — a terminal sitting at its prompt should not
   * push an event per second.
   */
  private async refreshLabels() {
    const live = this.liveSessions();
    if (live.length === 0) return;

    let table: ProcessTable = EMPTY_PROCESS_TABLE;
    try {
      table = await probeProcessTree();
    } catch {
      return;
    }

    for (const session of live) {
      if (session.exited) continue;
      const { hasRunningSubprocess, childCommand } = inspectSubprocess(table, session.pty.pid);
      const label = childCommand ?? terminalLabelFromId(session.terminalId);
      if (session.hasRunningSubprocess === hasRunningSubprocess && session.label === label) {
        continue;
      }

      session.hasRunningSubprocess = hasRunningSubprocess;
      session.label = label;
      this.emitMetadata({ type: 'upsert', terminal: summarize(session) });
    }
  }

  private append(session: PtySession, data: string) {
    const next = session.scrollback + data;
    session.scrollback =
      next.length > MAX_SCROLLBACK_CHARS ? next.slice(next.length - MAX_SCROLLBACK_CHARS) : next;
  }
}

function summarize(session: PtySession): TerminalSummary {
  return {
    conversationId: session.conversationId,
    terminalId: session.terminalId,
    cwd: session.cwd,
    status: session.exited ? 'exited' : 'running',
    pid: session.exited ? null : session.pty.pid,
    exitCode: session.exitCode,
    hasRunningSubprocess: session.hasRunningSubprocess,
    label: session.label,
  };
}
