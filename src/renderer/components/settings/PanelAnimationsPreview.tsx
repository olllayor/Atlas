import { type CSSProperties, useState } from "react";
import { cn } from "../../lib/utils";

export function PanelAnimationsPreview({ durationMs }: { durationMs: number }) {
  const [panelsOpen, setPanelsOpen] = useState(true);
  const transitionClass =
    "transition-[width,height,border-width] [transition-duration:var(--preview-duration)] ease-out motion-reduce:transition-none";

  return (
    <button
      type="button"
      aria-label="Replay panel animation preview"
      title="Click to replay panel animation"
      className="flex h-10 w-full cursor-pointer overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1 shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 sm:w-28 shrink-0"
      onClick={() => setPanelsOpen((open) => !open)}
      style={{ "--preview-duration": `${durationMs}ms` } as CSSProperties}
    >
      <span
        aria-hidden
        className={cn(
          "h-full shrink-0 overflow-hidden rounded-md bg-[var(--bg-subtle)]",
          transitionClass,
          panelsOpen ? "w-4" : "w-0"
        )}
      />
      <span aria-hidden className="flex min-w-0 flex-1 flex-col px-1">
        <span className="flex min-h-0 flex-1 flex-col gap-1 pt-1">
          <span className="h-0.5 w-full rounded-full bg-[var(--text-muted)] opacity-25" />
          <span className="h-0.5 w-4/5 rounded-full bg-[var(--text-muted)] opacity-20" />
          <span className="h-0.5 w-3/5 rounded-full bg-[var(--text-muted)] opacity-15" />
        </span>
        <span
          className={cn(
            "flex shrink-0 items-center overflow-hidden bg-[var(--bg-hover)] px-2",
            transitionClass,
            panelsOpen ? "h-2 border-t border-[var(--border-subtle)]" : "h-0 border-t-0"
          )}
        >
          <span className="h-px w-2/3 rounded-full bg-[var(--text-muted)] opacity-25" />
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "h-full shrink-0 overflow-hidden rounded-md bg-[var(--bg-active)]",
          transitionClass,
          panelsOpen ? "w-5" : "w-0"
        )}
      />
    </button>
  );
}
