/**
 * The workbench Terminal tab: a real shell, not a transcript.
 *
 * One PTY per conversation lives in the main process; this component is a view
 * onto it. Scrollback is replayed on mount so switching tabs or conversations
 * does not appear to reset a session that is still running, and the agent's own
 * commands arrive as dim `›` lines from the same stream.
 *
 * Three things this file is careful about:
 * 1. **Themes are live.** xterm takes literal colours, so the `--term-*`
 *    tokens are read on mount *and* re-read whenever the theme attributes on
 *    <html> change. Otherwise switching to light mode leaves a black slab.
 * 2. **The type matches the app.** Font family and size follow the user's own
 *    code-font settings, with a terminal-local zoom (⌘+/⌘-/⌘0) layered on top
 *    for the times a wide build log wants smaller text than the transcript.
 * 3. **The xterm instance outlives re-renders.** It is created once per
 *    conversation; everything else (theme, font, search) mutates it in place,
 *    because re-creating it would throw away the scrollback.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { getNormalizedEventKey } from '../../lib/keybindings';
import { TerminalSearchBar } from './TerminalSearchBar';

export type TerminalPanelHandle = {
  focus: () => void;
  clear: () => void;
  openSearch: () => void;
  zoom: (direction: 'in' | 'out' | 'reset') => void;
  /** The active selection, or null. Feeds the "add to prompt" affordance. */
  getSelectionText: () => string | null;
};

type TerminalPanelProps = {
  conversationId: string;
  /** Which of the conversation's shells this view is attached to. */
  terminalId: string;
  /** Told the shell's real cwd once the PTY answers, for the dock header. */
  onCwd?: (cwd: string) => void;
  /** ⌘E with a selection: pipe it to the composer as context. */
  onRequestSelectionPrompt?: () => void;
};

/**
 * The zoom is stored as an **offset in points**, not as an absolute size.
 *
 * The terminal's resting size is the app's own code-font setting, so a reader
 * who nudges the shell one step smaller and later changes Settings → Code font
 * size still gets "one step smaller than my code font" rather than a stale
 * absolute that silently detaches from the rest of the app.
 */
const FONT_OFFSET_STORAGE_KEY = 'atlas.terminal.fontOffset';
const MIN_FONT_SIZE = 9;
const MAX_FONT_SIZE = 24;
const MAX_FONT_OFFSET = 10;

/** The user's code-font setting, resolved through the theme contract. */
function readFontFamily(element: HTMLElement) {
  const styles = getComputedStyle(element);
  const family = styles.getPropertyValue('--font-code-mono').trim();
  return (
    family || 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
  );
}

function readCssPx(element: HTMLElement, token: string, fallback: number) {
  const raw = getComputedStyle(element).getPropertyValue(token).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBaseFontSize(element: HTMLElement) {
  return readCssPx(element, '--term-font-size', readCssPx(element, '--code-font-size', 13));
}

/**
 * Codex's small-text leading: `font-size + 4px`, taken as an absolute rather
 * than a ratio so the gap stays right across the whole zoom range.
 * xterm wants a multiplier, so the absolute is converted back at the size it
 * is being applied to.
 */
function leadingFor(element: HTMLElement, fontSize: number) {
  const extra = readCssPx(element, '--term-leading-extra', 4);
  return (fontSize + extra) / fontSize;
}

function readStoredOffset() {
  try {
    const stored = Number(window.localStorage.getItem(FONT_OFFSET_STORAGE_KEY));
    if (Number.isFinite(stored)) {
      return Math.min(MAX_FONT_OFFSET, Math.max(-MAX_FONT_OFFSET, Math.round(stored)));
    }
  } catch {
    // Private mode: the zoom just won't persist.
  }
  return 0;
}

/**
 * xterm needs literal colours, so the CSS custom properties are resolved here.
 * Every token falls back to a value that is legible on a dark backdrop, so a
 * theme that has not defined the terminal palette yet still gets a usable
 * shell rather than black-on-black.
 */
function readTheme(element: HTMLElement): ITheme {
  const styles = getComputedStyle(element);
  // xterm parses `#rgb[a]`, `#rrggbb[aa]` and `rgb()/rgba()` and throws on
  // anything else. Themes are free to write `color-mix(in oklab, …)`, which
  // some engines hand back as `oklab(…)` — so anything unrecognised falls back
  // rather than taking the whole terminal down with it.
  const parseable = (value: string) => /^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\(/i.test(value);
  const read = (token: string, fallback: string) => {
    const value = styles.getPropertyValue(token).trim();
    return parseable(value) ? value : fallback;
  };

  return {
    background: read('--term-bg', read('--bg-base', '#0d0d0d')),
    foreground: read('--term-fg', read('--text-secondary', '#ededed')),
    cursor: read('--term-cursor', read('--accent', '#ededed')),
    cursorAccent: read('--term-cursor-accent', read('--bg-base', '#0d0d0d')),
    selectionBackground: read('--term-selection', 'rgba(255, 255, 255, 0.2)'),
    selectionInactiveBackground: read('--term-selection-inactive', 'rgba(255, 255, 255, 0.1)'),
    black: read('--term-black', '#4b5262'),
    red: read('--term-red', '#ff6d78'),
    green: read('--term-green', '#5dd68a'),
    yellow: read('--term-yellow', '#f5c26b'),
    blue: read('--term-blue', '#7aa9ff'),
    magenta: read('--term-magenta', '#c79bf5'),
    cyan: read('--term-cyan', '#59d6d0'),
    white: read('--term-white', '#d6dbe4'),
    brightBlack: read('--term-bright-black', '#7b8497'),
    brightRed: read('--term-bright-red', '#ff9098'),
    brightGreen: read('--term-bright-green', '#86e5a7'),
    brightYellow: read('--term-bright-yellow', '#ffd894'),
    brightBlue: read('--term-bright-blue', '#9dc0ff'),
    brightMagenta: read('--term-bright-magenta', '#dab6ff'),
    brightCyan: read('--term-bright-cyan', '#7fe6e1'),
    brightWhite: read('--term-bright-white', '#ffffff'),
  };
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(
  function TerminalPanel({ conversationId, terminalId, onCwd, onRequestSelectionPrompt }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const searchRef = useRef<SearchAddon | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    // Held in a ref so an inline `onCwd` from the parent cannot re-run the
    // effect below — that would tear down and re-create the whole terminal.
    const onCwdRef = useRef(onCwd);
    onCwdRef.current = onCwd;
    // Same story: the xterm key handler is installed once.
    const onRequestSelectionPromptRef = useRef(onRequestSelectionPrompt);
    onRequestSelectionPromptRef.current = onRequestSelectionPrompt;
    // Kept in a ref, not in state: the key handler inside the xterm instance
    // is installed once and must read the live value.
    const fontOffsetRef = useRef(0);
    /** Shown for a beat after a zoom, so the size is not a mystery. */
    const [sizeHint, setSizeHint] = useState<number | null>(null);
    const sizeHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    /** Push the resting size + this session's zoom offset into xterm. */
    const applyType = useCallback((options: { announce?: boolean } = {}) => {
      const host = hostRef.current;
      const terminal = terminalRef.current;
      if (!host || !terminal) return;

      const size = Math.min(
        MAX_FONT_SIZE,
        Math.max(MIN_FONT_SIZE, readBaseFontSize(host) + fontOffsetRef.current)
      );

      terminal.options.fontFamily = readFontFamily(host);
      terminal.options.fontSize = size;
      terminal.options.lineHeight = leadingFor(host, size);

      if (!options.announce) return;

      setSizeHint(size);
      if (sizeHintTimer.current) clearTimeout(sizeHintTimer.current);
      sizeHintTimer.current = setTimeout(() => setSizeHint(null), 1200);
    }, []);

    const zoom = useCallback(
      (direction: 'in' | 'out' | 'reset') => {
        const next =
          direction === 'reset'
            ? 0
            : Math.min(
                MAX_FONT_OFFSET,
                Math.max(MAX_FONT_OFFSET * -1, fontOffsetRef.current + (direction === 'in' ? 1 : -1))
              );

        fontOffsetRef.current = next;
        try {
          if (next === 0) window.localStorage.removeItem(FONT_OFFSET_STORAGE_KEY);
          else window.localStorage.setItem(FONT_OFFSET_STORAGE_KEY, String(next));
        } catch {
          // Private mode: the zoom applies, it just won't persist.
        }

        applyType({ announce: true });
      },
      [applyType],
    );

    useEffect(
      () => () => {
        if (sizeHintTimer.current) clearTimeout(sizeHintTimer.current);
      },
      []
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => terminalRef.current?.focus(),
        clear: () => {
          terminalRef.current?.clear();
          terminalRef.current?.focus();
        },
        openSearch: () => setSearchOpen(true),
        zoom,
        getSelectionText: () => {
          const terminal = terminalRef.current;
          if (!terminal || !terminal.hasSelection()) return null;
          const text = terminal.getSelection();
          return text.trim() ? text : null;
        },
      }),
      [zoom],
    );

    useEffect(() => {
      const host = hostRef.current;
      if (!host || !window.atlasChat?.terminal?.start) {
        return;
      }

      let disposed = false;
      const root = document.documentElement;
      const reduceMotion = root.dataset.reduceMotion === 'true';

      fontOffsetRef.current = readStoredOffset();
      const initialFontSize = Math.min(
        MAX_FONT_SIZE,
        Math.max(MIN_FONT_SIZE, readBaseFontSize(host) + fontOffsetRef.current)
      );

      const terminal = new Terminal({
        convertEol: false,
        // A blinking cursor drives a repaint twice a second for as long as the
        // dock is open, and under the WebGL renderer each one is a GPU frame.
        // xterm already pauses the blink on blur, so the cost is bounded to a
        // focused terminal — but it is still motion, and Reduce motion turns
        // motion off. `cursorInactiveStyle` below keeps the focused/unfocused
        // distinction legible without it.
        cursorBlink: !reduceMotion,
        cursorStyle: 'bar',
        // An unfocused terminal that still shows a solid block reads as the
        // active input when it is not; the outline says "this is waiting".
        cursorInactiveStyle: 'outline',
        fontSize: initialFontSize,
        fontFamily: readFontFamily(host),
        // 400/600 rather than Codex's 430/500: those are variable-font optical
        // tweaks for a UI sans, and the mono faces this stack resolves to ship
        // discrete weights. In a shell, bold also carries meaning (prompts,
        // `ls` colours), so it stays a full step heavier than body.
        fontWeight: 400,
        fontWeightBold: 600,
        lineHeight: leadingFor(host, initialFontSize),
        // Codex defines no tracking token anywhere; mono grids are designed on
        // their own advance width and letter-spacing only breaks box drawing.
        letterSpacing: 0,
        theme: readTheme(host),
        scrollback: 10_000,
        // Programs that pick a colour close to the background (dim greys in
        // build logs) stay readable without flattening the palette.
        minimumContrastRatio: 3,
        smoothScrollDuration: reduceMotion ? 0 : 90,
        macOptionIsMeta: true,
        macOptionClickForcesSelection: true,
        rightClickSelectsWord: true,
        allowProposedApi: true,
        // Bold text keeps its colour instead of jumping to the bright ANSI
        // slot, which otherwise makes every bold word look highlighted.
        drawBoldTextInBrightColors: false,
      });
      terminalRef.current = terminal;

      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      searchRef.current = searchAddon;
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(searchAddon);
      terminal.loadAddon(
        // `window.open` is routed to the OS browser by the main process's
        // window-open handler, so a URL in a log is clickable.
        new WebLinksAddon((_event, uri) => {
          window.open(uri, '_blank', 'noopener,noreferrer');
        }),
      );
      terminal.open(host);

      // The GPU renderer is the difference between a crisp grid and blurry
      // half-pixel glyphs on a scaled display — but it can lose its context
      // (GPU reset, display change), and xterm then needs to fall back to the
      // DOM renderer rather than render nothing at all.
      let webglAddon: WebglAddon | null = null;
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webglAddon = null;
          try {
            webgl.dispose();
          } catch {
            // Already torn down with its context; nothing left to release.
          }
        });
        terminal.loadAddon(webgl);
        webglAddon = webgl;
      } catch {
        // No WebGL (software rendering, a locked-down GPU): the DOM renderer
        // is slower but correct.
      }

      const safeFit = () => {
        try {
          if (host.clientWidth > 0 && host.clientHeight > 0) {
            fitAddon.fit();
          }
        } catch {
          // The panel can be measured while hidden, where fit() has nothing to
          // divide by. The next resize observation corrects it.
        }
      };

      safeFit();

      const unsubscribe = window.atlasChat.terminal.subscribe((event) => {
        if (disposed || event.conversationId !== conversationId || event.terminalId !== terminalId) {
          return;
        }
        terminal.write(event.data);
      });

      const inputDisposable = terminal.onData((data) => {
        void window.atlasChat.terminal
          .write({ conversationId, terminalId, data })
          .catch(() => {});
      });

      // Shortcuts the app owns rather than the shell. Everything else — Ctrl-C,
      // Ctrl-R, the arrow keys — belongs to the program on the other end and is
      // passed straight through.
      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') {
          return true;
        }

        const mod = event.metaKey || event.ctrlKey;
        if (!mod) {
          return true;
        }

        // Matched on `event.code` (via the same normalizer as the app's
        // keybindings), not `event.key`: on a Cyrillic or Greek layout the
        // physical C/V/F/K keys produce native characters, and key-based
        // matching silently killed every one of these shortcuts.
        const key = getNormalizedEventKey(event);

        // ⌘C with a selection copies; without one it must still reach the
        // shell as an interrupt.
        if (key === 'c' && event.metaKey && terminal.hasSelection()) {
          void navigator.clipboard.writeText(terminal.getSelection()).catch(() => {});
          return false;
        }

        if (key === 'v' && event.metaKey) {
          void navigator.clipboard
            .readText()
            .then((text) => {
              if (text) terminal.paste(text);
            })
            .catch(() => {});
          return false;
        }

        if (key === 'f' && event.metaKey) {
          setSearchOpen(true);
          return false;
        }

        if (key === 'k' && event.metaKey) {
          terminal.clear();
          return false;
        }

        // Selection → composer context (t3code's terminal_context gesture).
        if (key === 'e' && event.metaKey && onRequestSelectionPromptRef.current) {
          if (terminal.hasSelection()) {
            onRequestSelectionPromptRef.current();
            return false;
          }
          // No selection: let ⌘E fall through untouched.
        }

        if (key === '=' || key === '+') {
          zoom('in');
          return false;
        }

        if (key === '-') {
          zoom('out');
          return false;
        }

        if (key === '0') {
          zoom('reset');
          return false;
        }

        return true;
      });

      // Start after the first fit so the shell is spawned with the size it will
      // actually be drawn at — otherwise the first prompt wraps at 80 columns.
      void window.atlasChat.terminal
        .start({ conversationId, terminalId, cols: terminal.cols, rows: terminal.rows })
        .then((result) => {
          if (disposed) return;
          if (result.scrollback) {
            terminal.write(result.scrollback);
          }
          if (result.cwd) {
            onCwdRef.current?.(result.cwd);
          }
        })
        .catch((err: unknown) => {
          if (disposed) return;
          setError(
            err instanceof Error ? err.message : 'Could not start a shell for this conversation.',
          );
        });

      const observer = new ResizeObserver(() => {
        safeFit();
        void window.atlasChat.terminal
          .resize({ conversationId, terminalId, cols: terminal.cols, rows: terminal.rows })
          .catch(() => {});
      });
      observer.observe(host);

      // Theme and font live on <html>: the appearance settings rewrite those
      // attributes and custom properties in place, and xterm cannot observe
      // CSS on its own. `applyType` re-reads the resting size, so moving
      // Settings → Code font size moves the shell with it — the zoom offset
      // rides on top and is preserved.
      const themeObserver = new MutationObserver(() => {
        if (disposed) return;
        terminal.options.theme = readTheme(host);
        applyType();
        safeFit();
      });
      themeObserver.observe(root, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-design-theme', 'style', 'data-reduce-motion'],
      });

      return () => {
        disposed = true;
        observer.disconnect();
        themeObserver.disconnect();
        unsubscribe();
        inputDisposable.dispose();
        searchRef.current = null;
        terminalRef.current = null;
        // The GPU renderer goes first, and defensively: the addon reaches into
        // xterm's private core during its own teardown, so a version skew or a
        // context that is already gone throws from here — and a throw in an
        // effect cleanup unmounts the whole panel with an error boundary.
        try {
          webglAddon?.dispose();
        } catch {
          // Renderer already released; the DOM layer below it still tears down.
        }
        webglAddon = null;
        // The PTY deliberately outlives the view: a long build keeps running
        // while the user reads the transcript. It is killed when the
        // conversation is deleted or the app quits.
        try {
          terminal.reset();
          terminal.dispose();
        } catch {
          // Same reasoning: never let teardown take the view with it.
        }
      };
    }, [applyType, conversationId, terminalId, zoom]);

    return (
      <div className="atlas-terminal relative flex h-full min-h-0 flex-col">
        {error ? (
          <p className="px-4 py-2 text-sm text-error" role="status">
            {error}
          </p>
        ) : null}

        {searchOpen ? (
          <TerminalSearchBar
            onSearch={(query, direction) => {
              const addon = searchRef.current;
              const host = hostRef.current;
              if (!addon || !host || !query) return false;

              const styles = getComputedStyle(host);
              const token = (name: string, fallback: string) =>
                styles.getPropertyValue(name).trim() || fallback;
              const accent = token('--accent', '#7aa9ff');
              // Every other match is tinted; the one you are on is solid, so
              // "next" is visible without hunting.
              const options = {
                decorations: {
                  matchBackground: token('--term-bright-black', '#7b8497'),
                  matchOverviewRuler: accent,
                  activeMatchBackground: accent,
                  activeMatchColorOverviewRuler: accent,
                },
              };

              return direction === 'previous'
                ? addon.findPrevious(query, options)
                : addon.findNext(query, options);
            }}
            onClose={() => {
              setSearchOpen(false);
              searchRef.current?.clearDecorations();
              terminalRef.current?.focus();
            }}
          />
        ) : null}

        {/* The zoom is otherwise invisible: three ⌘- presses and you are
            guessing what you are looking at. */}
        {sizeHint != null ? (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-2 right-3 z-10 rounded-md border border-border-subtle bg-bg-overlay px-2 py-0.5 font-mono text-2xs tabular-nums text-text-tertiary shadow-sm"
          >
            {sizeHint}px
          </div>
        ) : null}

        {/*
          The grid needs breathing room on all four sides — xterm draws cells
          flush to its host, and a prompt touching the dock's edge reads as a
          rendering bug. Bottom padding is smaller so the newest line sits just
          above the seam rather than floating.
        */}
        <div
          ref={hostRef}
          className="min-h-0 flex-1 pt-2 pr-2 pb-1 pl-3"
          onMouseDown={(event) => {
            // A click anywhere in the padding still means "type here".
            if (event.target === event.currentTarget) {
              terminalRef.current?.focus();
            }
          }}
        />
      </div>
    );
  },
);
