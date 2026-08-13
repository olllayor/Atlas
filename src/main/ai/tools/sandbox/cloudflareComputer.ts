import { BoundedCommandOutput } from '../commandOutputCap';
import type { ToolWorkspace } from '../toolWorkspace';
import type { BashToolResult } from './types';

export type CloudSandboxConfig = {
  endpoint: string;
  authToken?: string | null;
};

export type CloudNDJSONEvent =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'exit'; code: number | null; interrupted?: boolean }
  | { type: 'error'; error: string };

export type CloudHealthCheckResult = {
  success: boolean;
  latencyMs?: number;
  version?: string;
  error?: string;
};

export async function cloudHealthCheck(config: CloudSandboxConfig): Promise<CloudHealthCheckResult> {
  const endpointUrl = config.endpoint.replace(/\/+$/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);
  const startTime = Date.now();

  try {
    const response = await fetch(`${endpointUrl}/health`, {
      method: 'GET',
      headers: {
        ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
      },
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return {
        success: false,
        latencyMs,
        error: `HTTP ${response.status}: ${errText || response.statusText}`,
      };
    }

    const data = await response.json().catch(() => ({}));
    return {
      success: true,
      latencyMs,
      version: data?.version ?? '0.1.0',
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      success: false,
      latencyMs,
      error: err.name === 'AbortError' ? 'Connection timed out (8s)' : (err.message || String(err)),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function cloudResetSession(
  conversationId: string,
  config: CloudSandboxConfig
): Promise<{ success: boolean; error?: string }> {
  const endpointUrl = config.endpoint.replace(/\/+$/, '');
  try {
    const response = await fetch(`${endpointUrl}/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
      },
      body: JSON.stringify({ conversationId }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { success: false, error: `HTTP ${response.status}: ${errText || response.statusText}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

export async function cloudBashExecute(
  input: {
    command: string;
    timeout?: number;
    description?: string;
    dangerouslyDisableSandbox?: boolean;
  },
  workspace: ToolWorkspace | undefined,
  config: CloudSandboxConfig
): Promise<BashToolResult> {
  const timeoutMs = Math.max(100, Math.min(Math.floor(input.timeout ?? 30_000), 120_000));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs + 3_000);

  const stdoutCap = new BoundedCommandOutput();
  const stderrCap = new BoundedCommandOutput();
  let exitCode: number | null = null;
  let interrupted = false;

  const endpointUrl = config.endpoint.replace(/\/+$/, '');

  try {
    const response = await fetch(`${endpointUrl}/exec`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
      },
      body: JSON.stringify({
        command: input.command,
        conversationId: workspace?.conversationId ?? workspace?.projectId ?? 'default',
        env: workspace?.env ?? {},
        timeoutMs,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Cloud sandbox HTTP ${response.status}: ${errText || response.statusText}`);
    }

    const reader = (response.body as any).getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event: CloudNDJSONEvent = JSON.parse(line);
          if (event.type === 'stdout') {
            stdoutCap.write(event.data);
          } else if (event.type === 'stderr') {
            stderrCap.write(event.data);
          } else if (event.type === 'exit') {
            exitCode = event.code;
            interrupted = Boolean(event.interrupted);
          } else if (event.type === 'error') {
            stderrCap.write(`[Cloud Sandbox Error] ${event.error}\n`);
          }
        } catch {
          // Ignore JSON parse errors for incomplete chunks
        }
      }
    }

    if (buffer.trim()) {
      try {
        const event: CloudNDJSONEvent = JSON.parse(buffer);
        if (event.type === 'stdout') {
          stdoutCap.write(event.data);
        } else if (event.type === 'stderr') {
          stderrCap.write(event.data);
        } else if (event.type === 'exit') {
          exitCode = event.code;
          interrupted = Boolean(event.interrupted);
        } else if (event.type === 'error') {
          stderrCap.write(`[Cloud Sandbox Error] ${event.error}\n`);
        }
      } catch {
        // Ignore JSON parse error
      }
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      interrupted = true;
    } else {
      stderrCap.write(`[Cloud Sandbox Connection Error] ${error.message || String(error)}\n`);
    }
  } finally {
    clearTimeout(timeoutId);
  }

  const rawStdout = stdoutCap.toString();
  const rawStderr = stderrCap.toString();
  const isSuccess = !interrupted && exitCode === 0;
  const stdout = isSuccess && !rawStdout.trim() && !rawStderr.trim()
    ? '(Command executed successfully with exit code 0)'
    : rawStdout;

  workspace?.onCommandRun?.({ command: input.command, exitCode, venue: 'cloud' });

  return {
    stdout,
    stderr: rawStderr,
    interrupted,
    sandbox: 'cloud',
    sandboxNetwork: 'allow',
    // Escalation is a local-sandbox concept; the DO isolate is already the
    // most restrictive venue, so the flag is reported as-is for transparency
    // rather than flipped on.
    sandboxEscalated: Boolean(input.dangerouslyDisableSandbox),
    ...(stdoutCap.truncated || stderrCap.truncated ? { outputTruncated: true as const } : {}),
    returnCodeInterpretation: interrupted
      ? 'timed_out'
      : exitCode === 0
      ? 'success'
      : `exit_code_${exitCode ?? 'unknown'}`,
  };
}
