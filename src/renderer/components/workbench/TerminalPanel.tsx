/**
 * The workbench Terminal tab: a real shell, not a transcript.
 *
 * One PTY per conversation lives in the main process; this component is a view
 * onto it. Scrollback is replayed on mount so switching tabs or conversations
 * does not appear to reset a session that is still running, and the agent's own
 * commands arrive as dim `›` lines from the same stream.
 */

import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

type TerminalPanelProps = {
  conversationId: string;
};

/**
 * xterm needs literal colours, so the CSS custom properties are read once at
 * mount rather than passed as class names. Falls back to the Codex palette when
 * a token is missing (e.g. a theme that has not defined it yet).
 */
function readThemeColors(element: HTMLElement) {
  const styles = getComputedStyle(element);
  const read = (token: string, fallback: string) => {
    const value = styles.getPropertyValue(token).trim();
    return value || fallback;
  };

  return {
    background: read('--color-bg-base', '#0d0d0d'),
    foreground: read('--color-text-primary', '#ededed'),
    cursor: read('--color-text-primary', '#ededed'),
    selectionBackground: read('--color-bg-hover', '#2a2a2a'),
  };
}

export function TerminalPanel({ conversationId }: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !window.atlasChat?.terminal?.start) {
      return;
    }

    let disposed = false;
    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontSize: 12,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      theme: readThemeColors(host),
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);

    const safeFit = () => {
      try {
        fitAddon.fit();
      } catch {
        // The panel can be measured while hidden, where fit() has nothing to
        // divide by. The next resize observation corrects it.
      }
    };

    safeFit();

    const unsubscribe = window.atlasChat.terminal.subscribe((event) => {
      if (disposed || event.conversationId !== conversationId) {
        return;
      }
      terminal.write(event.data);
    });

    const inputDisposable = terminal.onData((data) => {
      void window.atlasChat.terminal.input(conversationId, data).catch(() => {});
    });

    // Start after the first fit so the shell is spawned with the size it will
    // actually be drawn at — otherwise the first prompt wraps at 80 columns.
    void window.atlasChat.terminal
      .start(conversationId, terminal.cols, terminal.rows)
      .then((result) => {
        if (disposed) return;
        if (result.scrollback) {
          terminal.write(result.scrollback);
        }
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : 'Could not start a shell for this conversation.');
      });

    const observer = new ResizeObserver(() => {
      safeFit();
      void window.atlasChat.terminal
        .resize(conversationId, terminal.cols, terminal.rows)
        .catch(() => {});
    });
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      unsubscribe();
      inputDisposable.dispose();
      // The PTY deliberately outlives the view: a long build keeps running
      // while the user reads the transcript. It is killed when the
      // conversation is deleted or the app quits.
      terminal.dispose();
    };
  }, [conversationId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error ? (
        <p className="px-4 py-2 text-sm text-error" role="status">
          {error}
        </p>
      ) : null}
      <div ref={hostRef} className="min-h-0 flex-1 px-2 py-1" />
    </div>
  );
}
