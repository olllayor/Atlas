import { memo } from 'react';
import { AlertTriangle, X } from 'lucide-react';

import type { ServerProvider } from './ChatView.logic.js';

export function getProviderStatusBannerKey(status: ServerProvider | null): string | null {
  if (!status || status.status === 'ready' || status.status === 'disabled') {
    return null;
  }
  // Antigravity checks saved credentials when a session starts. Its local
  // health check leaves auth unknown after a restart, which is not a failure.
  if (
    status.driver === 'antigravity' &&
    status.installed &&
    status.status === 'warning' &&
    status.auth.status === 'unknown'
  ) {
    return null;
  }
  return [status.instanceId ?? '', status.status ?? '', status.auth.status, status.message ?? ''].join(
    '\u0000'
  );
}

export function shouldShowProviderStatusBanner(
  status: ServerProvider | null,
  dismissedKey: string | null
): boolean {
  const key = getProviderStatusBannerKey(status);
  return key !== null && key !== dismissedKey;
}

export interface ProviderStatusBannerProps {
  className?: string;
  dismissedKey: string | null;
  onDismiss?: (key: string) => void;
  onOpenProviderSetup?: (instanceId: string) => void;
  status: ServerProvider | null;
}

export const ProviderStatusBanner = memo(function ProviderStatusBanner({
  className,
  dismissedKey,
  onDismiss,
  onOpenProviderSetup,
  status
}: ProviderStatusBannerProps) {
  if (!status || getProviderStatusBannerKey(status) === null) {
    return null;
  }

  const key = getProviderStatusBannerKey(status);
  if (!key || (dismissedKey && key === dismissedKey)) {
    return null;
  }

  const isError = status.status === 'error';
  const message = status.message ?? (isError ? 'Provider error encountered.' : 'Provider warning.');

  return (
    <div
      role="alert"
      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs transition-colors ${
        isError
          ? 'border-error/30 bg-error/10 text-text-primary'
          : 'border-warning/30 bg-warning/10 text-text-primary'
      } ${className ?? ''}`}
    >
      <AlertTriangle className={`h-4 w-4 shrink-0 ${isError ? 'text-error' : 'text-warning'}`} />
      <span className="min-w-0 flex-1 truncate">{message}</span>
      {onOpenProviderSetup && status.instanceId ? (
        <button
          type="button"
          onClick={() => onOpenProviderSetup(status.instanceId!)}
          className="shrink-0 font-medium underline underline-offset-2 hover:opacity-80"
        >
          Configure
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          aria-label="Dismiss banner"
          onClick={() => onDismiss(key)}
          className="shrink-0 text-text-secondary hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
});
