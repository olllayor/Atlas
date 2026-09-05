/**
 * Friendly failure taxonomy for talking to an OpenCode binary/server — a 1:1
 * port of the branch table in pingdotgg/t3code's `Layers/OpenCodeProvider.ts`
 * (`formatOpenCodeProbeError`), worded for Atlas surfaces.
 */

export interface OpenCodeFailureReport {
  /** false ⇒ treat as "CLI missing"; true ⇒ reachable/known-installed but failing. */
  readonly installed: boolean;
  readonly message: string;
}

const NETWORK_HINTS = [
  'econnrefused',
  'enotfound',
  'fetch failed',
  'networkerror',
  'timed out',
  'timeout',
  'socket hang up'
] as const;

const AUTH_HINTS = ['401', '403', 'unauthorized', 'forbidden'] as const;

function lowerSafe(cause: unknown): string {
  const text =
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : String(cause);
  return text.toLowerCase();
}

function normalize(message: string): string | undefined {
  const trimmed = message.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Extract a human sentence out of arbitrary throwables (incl. SDK shapes). */
export function describeCause(cause: unknown): string | undefined {
  if (cause instanceof Error) {
    return normalize(cause.message);
  }
  if (typeof cause === 'object' && cause !== null) {
    const record = cause as Record<string, unknown>;
    const status = (record.response as { status?: number } | undefined)?.status;
    const body = record.error ?? record.data ?? record.body ?? record.message;
    if (typeof body === 'string') {
      const normalizedBody = normalize(body);
      if (normalizedBody !== undefined) {
        return status !== undefined ? `status=${status} ${normalizedBody}` : normalizedBody;
      }
    }
  }
  return normalize(String(cause));
}

export function describeOpenCodeFailure(
  cause: unknown,
  options: { readonly isExternalServer: boolean; readonly serverUrl: string }
): OpenCodeFailureReport {
  const detail = describeCause(cause);
  const lower = detail?.toLowerCase() ?? '';

  if (options.isExternalServer) {
    if (AUTH_HINTS.some((hint) => lower.includes(hint))) {
      return {
        installed: true,
        message: 'OpenCode server rejected authentication. Check the server URL and password.'
      };
    }
    if (NETWORK_HINTS.some((hint) => lower.includes(hint))) {
      return {
        installed: true,
        message: `Couldn't reach the configured OpenCode server at ${options.serverUrl}. Check that the server is running and the URL is correct.`
      };
    }
    return {
      installed: true,
      message: detail ?? 'Failed to connect to the configured OpenCode server.'
    };
  }

  if (lower.includes('enoent') || lower.includes('not found') || lower.includes('modulenotfound')) {
    return {
      installed: false,
      message: 'OpenCode CLI (`opencode`) is not installed or not on PATH.'
    };
  }

  if (AUTH_HINTS.some((hint) => lower.includes(hint))) {
    return {
      installed: true,
      message:
        'The local OpenCode server rejected authentication. The spawned server password and the stored keychain password disagree — clear the saved password in Settings and retry, then restart Atlas if it persists.'
    };
  }

  if (lower.includes('quarantine')) {
    return {
      installed: true,
      message: 'macOS is blocking the OpenCode binary (quarantine attribute). Run `xattr -dr com.apple.quarantine` on the binary or reinstall via Homebrew.'
    };
  }

  if (NETWORK_HINTS.some((hint) => lower.includes(hint))) {
    return {
      installed: true,
      message: 'Could not start or reach the local OpenCode server. Try again, or set a Server URL in Settings.'
    };
  }

  return {
    installed: true,
    message: detail ?? 'Failed to talk to the OpenCode installation.'
  };
}
