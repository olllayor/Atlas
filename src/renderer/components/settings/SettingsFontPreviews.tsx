import { FileCode, Hexagon, Atom, Check, AlertTriangle, X } from "lucide-react";
import { type CSSProperties } from "react";

export function PromptFontPreview({ family, size }: { family?: string; size?: number }) {
  const style: CSSProperties = {
    fontFamily: family ? `${family}, var(--font-composer, var(--font-sans))` : "var(--font-composer, var(--font-sans))",
    fontSize: size ? `${size}px` : "var(--font-size-prompt, 14px)",
    lineHeight: 1.5,
  };

  return (
    <div
      className="mt-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-[var(--text-primary)] shadow-xs transition-colors"
      style={style}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span>Use</span>
        <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs font-normal text-[var(--text-primary)]">
          <Hexagon className="size-3 text-[var(--accent)]" />
          <span>Frontend Design</span>
        </span>
        <span>to fix the flaky test in</span>
        <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs font-mono font-medium text-[var(--text-primary)]">
          <span className="rounded bg-[var(--accent)]/20 px-1 text-[10px] font-bold text-[var(--accent)]">TS</span>
          <span>surface.test.ts</span>
        </span>
        <span>and align the header with</span>
        <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs font-mono font-medium text-[var(--text-primary)]">
          <Atom className="size-3 text-[var(--accent)]" />
          <span>SettingsPanels.tsx</span>
        </span>
        <span>before shipping.</span>
      </div>
    </div>
  );
}

export function CodeFontPreview({ family, size }: { family?: string; size?: number }) {
  const style: CSSProperties = {
    fontFamily: family ? `${family}, var(--font-mono)` : "var(--font-mono)",
    fontSize: size ? `${size}px` : "var(--font-size-code, 13px)",
    lineHeight: 1.6,
  };

  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--code-background,var(--bg-base))] shadow-xs">
      {/* File Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2 font-mono text-[var(--text-secondary)]">
          <FileCode className="size-3.5 text-[var(--accent)]" />
          <span className="font-medium text-[var(--text-primary)]">src/formatUser.ts</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-xs">
          <span className="text-error font-medium">-1</span>
          <span className="text-success font-medium">+1</span>
        </div>
      </div>

      {/* Code diff lines */}
      <div className="p-2 font-mono" style={style}>
        {/* Line 1 */}
        <div className="flex items-center">
          <span className="w-6 shrink-0 select-none text-right pr-3 text-[var(--text-muted)] opacity-60 text-xs">1</span>
          <span className="text-[var(--text-primary)]">
            <span className="text-[var(--accent)]">export</span>{" "}
            <span className="text-[var(--accent)]">function</span>{" "}
            <span className="font-semibold text-[var(--text-primary)]">formatUser</span>(user: User) &#123;
          </span>
        </div>

        {/* Line 2 Deleted */}
        <div className="flex items-center bg-error-bg/30 text-error-text -mx-2 px-2 border-l-2 border-error">
          <span className="w-6 shrink-0 select-none text-right pr-3 text-error text-xs">-</span>
          <span>
            {"    "}<span className="text-[var(--accent)]">return</span> user.name.toUpperCase();
          </span>
        </div>

        {/* Line 2 Added */}
        <div className="flex items-center bg-success-bg/30 text-success-text -mx-2 px-2 border-l-2 border-success">
          <span className="w-6 shrink-0 select-none text-right pr-3 text-success text-xs">+</span>
          <span>
            {"    "}<span className="text-[var(--accent)]">return</span> `$&#123;user.name&#125; &lt;$&#123;user.email&#125;&gt;`;{" "}
            <span className="text-[var(--text-muted)] opacity-70">// 0O 1lI</span>
          </span>
        </div>

        {/* Line 3 */}
        <div className="flex items-center">
          <span className="w-6 shrink-0 select-none text-right pr-3 text-[var(--text-muted)] opacity-60 text-xs">3</span>
          <span className="text-[var(--text-primary)]">&#125;</span>
        </div>
      </div>
    </div>
  );
}

export function TerminalFontPreview({ family, size }: { family?: string; size?: number }) {
  const style: CSSProperties = {
    fontFamily: family ? `${family}, var(--font-terminal, var(--font-mono))` : "var(--font-terminal, var(--font-mono))",
    fontSize: size ? `${size}px` : "var(--font-size-terminal, 12px)",
    lineHeight: 1.5,
  };

  return (
    <div
      className="mt-2.5 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--terminal-background,var(--bg-base))] p-3.5 shadow-xs font-mono select-text"
      style={style}
    >
      <div className="space-y-1">
        {/* Vite header */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-success">VITE</span>
          <span className="text-success opacity-80">v7.1.1</span>
          <span className="text-[var(--text-muted)]">ready in</span>
          <span className="font-semibold text-[var(--text-primary)]">1.24s</span>
        </div>

        <div className="h-1" />

        {/* Local / Network */}
        <div className="flex items-center gap-2">
          <span className="text-success font-bold">➜</span>
          <span className="text-[var(--text-muted)]">Local:</span>
          <span className="text-[var(--accent)] underline underline-offset-2">http://127.0.0.1:5173/</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-success font-bold">➜</span>
          <span className="text-[var(--text-muted)]">Network:</span>
          <span className="text-[var(--accent)] underline underline-offset-2">http://192.168.1.24:5173/</span>
        </div>

        <div className="h-1" />

        {/* Test status line */}
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1 text-success">
            <Check className="size-3.5 stroke-[3]" />
            <span>85 passed</span>
          </span>
          <span className="flex items-center gap-1 text-warning">
            <AlertTriangle className="size-3.5" />
            <span>2 warnings</span>
          </span>
          <span className="flex items-center gap-1 text-error">
            <X className="size-3.5 stroke-[3]" />
            <span>0 failed</span>
          </span>
        </div>

        <div className="h-1" />

        {/* READY badge */}
        <div className="flex items-center gap-2">
          <span className="rounded bg-success/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-success">
            READY
          </span>
          <span className="text-[var(--text-muted)]">
            watching for changes — press <span className="font-semibold text-[var(--text-primary)]">q</span> to quit
          </span>
        </div>

        <div className="h-1" />

        {/* Prompt line with blinking cursor */}
        <div className="flex items-center gap-2">
          <span className="text-success font-bold">➜</span>
          <span className="font-bold text-[var(--accent)]">atlas</span>
          <span className="text-[var(--text-muted)]">
            git:(<span className="text-error font-medium">main</span>)
          </span>
          <span className="text-warning">✗</span>
          <span className="inline-block w-2 h-4 bg-[var(--text-primary)] animate-pulse" />
        </div>
      </div>
    </div>
  );
}
