import { CheckIcon, Cross2Icon } from '@radix-ui/react-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * One field height (h-9), one border token, one radius — shared by every
 * providers surface so the border-radius preference actually governs them.
 */
export const fieldInputClass =
  'h-9 w-full rounded-md border border-border-default bg-bg-subtle px-3 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-60';

export const fieldLabelClass = 'block text-sm text-text-tertiary';

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="mt-5">
      <label htmlFor={htmlFor} className={fieldLabelClass}>
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-error">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** Inline validation text. Always announced, always on the error token. */
export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-1.5 text-xs text-error">
      {children}
    </p>
  );
}

/** Dismissible banner for store-level failures (create/update/discover). */
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="mt-4 flex items-start justify-between gap-3 rounded-md border border-error-border bg-error-bg px-3 py-2"
    >
      <span className="min-w-0 text-xs leading-5 text-error-text">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-error-text/80 transition hover:bg-bg-hover hover:text-error-text"
      >
        <Cross2Icon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** The transient "Saved" micro-confirmation used by every blur-commit field. */
export function SavedHint({ show, label = 'Saved' }: { show: boolean; label?: string }) {
  return (
    <span
      aria-live="polite"
      className={`inline-flex items-center gap-1 text-xs text-success transition-opacity duration-fast ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <CheckIcon className="h-3.5 w-3.5" />
      {show ? label : null}
    </span>
  );
}

/**
 * Flashes a confirmation for ~1.6s. Returns the flag plus the trigger, and
 * clears its timer on unmount so a fast provider switch cannot leak it.
 */
export function useSavedFlash(duration = 1600) {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    []
  );

  const flash = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }

    setSaved(true);
    timer.current = setTimeout(() => setSaved(false), duration);
  }, [duration]);

  return { saved, flash };
}

/** `https://api.example.com/v1` → parseable, absolute, http(s). */
export function validateBaseUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) {
    return 'Enter the API root for this provider.';
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'That is not a valid URL. Include the scheme, e.g. https://api.example.com/v1';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Use an http or https URL.';
  }

  return null;
}

/** Non-blocking advice: the app appends the completion path itself. */
export function baseUrlWarning(raw: string): string | null {
  const value = raw.trim().replace(/\/+$/, '');
  if (/\/(chat\/completions|messages|responses|models)$/i.test(value)) {
    return 'This looks like an endpoint path. Atlas appends the endpoint itself — use the API root.';
  }

  return null;
}

/** `sk-proj-abc…4f2a` — enough to recognise a key without revealing it. */
export function fingerprintApiKey(key: string): string {
  const value = key.trim();
  if (value.length <= 8) {
    return `${'•'.repeat(Math.max(value.length - 2, 0))}${value.slice(-2)}`;
  }

  const prefixMatch = value.match(/^[A-Za-z]+[-_]/);
  const prefix = prefixMatch ? prefixMatch[0] : value.slice(0, 3);
  return `${prefix}…${value.slice(-4)}`;
}
