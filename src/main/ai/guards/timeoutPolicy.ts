/**
 * Cooperative per-tool timeout enforcement, ported from DeepSeek Harness's
 * `guard/timeout-policy` plugin.
 *
 * A tool declares `timeoutMs` on its definition and promises to honor the
 * `abortSignal` it receives; this wrapper arms that deadline by fusing the
 * caller's abort signal with a timer, and maps its own expiry to a
 * structured TOOL_TIMEOUT result. Zero-config: the budget is read from the
 * tool's own declaration, so there is no name-keyed policy table to drift.
 *
 * Invariants kept from the original:
 *
 * - Cooperative, never a hard kill. The fused signal only notifies; a tool
 *   that ignores it does not stop. Only signal-forwarding tools should
 *   declare `timeoutMs` — bash/grep/git declare none because they enforce
 *   their own process-level timeouts.
 * - The replacement is keyed on THIS wrapper's timer, not on the abort the
 *   tool saw: an upstream abort (user stop, turn abort) propagates as an
 *   ordinary abort, never as a TOOL_TIMEOUT. This is the Atlas version of
 *   dsh's `timeoutOf(signal, TOOL_TIMEOUT)` scoping.
 * - No racing or abandoning the tool promise: the wrapper awaits the tool to
 *   quiescence, then replaces its result if the timer fired. A slow tool
 *   that ignores the signal therefore delays the timeout result, but is
 *   never left dangling behind a resolved promise.
 */

/** The code this guard owns: the abort reason and the structured result code. */
export const TOOL_TIMEOUT = 'TOOL_TIMEOUT';

/** The error name carried on the abort reason, for the scoping check. */
const TOOL_TIMEOUT_ERROR_NAME = 'ToolTimeoutError';

export interface TimeoutPolicyOptions {
  /**
   * Budgets for tools that do not declare their own `timeoutMs`. Declaring
   * on the tool is preferred; this is the seam for wrapping tool sets whose
   * definitions cannot be edited (plugins, MCP).
   */
  defaults?: Record<string, number>;
}

/** The structured result substituted when this wrapper's deadline wins. */
export function toolTimeoutResult(timeoutMs: number): {
  timedOut: true;
  code: typeof TOOL_TIMEOUT;
  message: string;
} {
  return {
    timedOut: true,
    code: TOOL_TIMEOUT,
    message: `Error: tool call timed out after ${timeoutMs}ms`
  };
}

/** True when THIS wrapper's timer fired (never for an upstream abort). */
function isOwnTimeout(controller: AbortController): boolean {
  const reason = controller.signal.reason as { name?: unknown } | undefined;
  return controller.signal.aborted && reason?.name === TOOL_TIMEOUT_ERROR_NAME;
}

type ToolLike = {
  execute?: (input: unknown, options?: { abortSignal?: AbortSignal } & Record<string, unknown>) => unknown;
  timeoutMs?: unknown;
};

function resolveBudget(tool: ToolLike, name: string, options: TimeoutPolicyOptions | undefined): number | undefined {
  if (typeof tool.timeoutMs === 'number' && Number.isFinite(tool.timeoutMs) && tool.timeoutMs > 0) {
    return tool.timeoutMs;
  }
  const fallback = options?.defaults?.[name];
  if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0) {
    return fallback;
  }
  return undefined;
}

/**
 * Wrap every executable tool in `tools` that has a timeout budget and return
 * the wrapped set. Tools without a budget pass through by reference; the
 * wrapper never throws for a non-timeout failure.
 */
export function applyTimeoutPolicy<T extends Record<string, unknown>>(
  tools: T,
  options: TimeoutPolicyOptions = {}
): T {
  const wrapped: Record<string, unknown> = {};

  for (const [name, definition] of Object.entries(tools)) {
    const tool = definition as ToolLike;

    if (typeof tool.execute !== 'function') {
      wrapped[name] = definition;
      continue;
    }

    const budget = resolveBudget(tool, name, options);
    if (budget === undefined) {
      wrapped[name] = definition;
      continue;
    }

    const originalExecute = tool.execute;

    wrapped[name] = {
      ...tool,
      execute: async (input: unknown, execOptions?: { abortSignal?: AbortSignal } & Record<string, unknown>) => {
        const upstream = execOptions?.abortSignal;
        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort({ name: TOOL_TIMEOUT_ERROR_NAME, code: TOOL_TIMEOUT });
        }, budget);

        const signal = upstream ? AbortSignal.any([upstream, controller.signal]) : controller.signal;

        try {
          const result = await originalExecute(input, { ...execOptions, abortSignal: signal });
          return isOwnTimeout(controller) ? toolTimeoutResult(budget) : result;
        } catch (error) {
          // Our timer firing reads as an abort inside the tool; map it to the
          // structured result. Anything else — including an upstream abort —
          // propagates unchanged.
          if (isOwnTimeout(controller)) {
            return toolTimeoutResult(budget);
          }
          throw error;
        } finally {
          clearTimeout(timer);
        }
      }
    };
  }

  return wrapped as T;
}
