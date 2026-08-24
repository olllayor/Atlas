/**
 * Subagent provider capabilities, ported from DeepSeek Harness's
 * `@deepseek-ai/dsh-subagent` seam: every provider publishes a static
 * descriptor of what it supports, and a spawn request is validated against it
 * BEFORE any resource is consumed. The contract is fail-loud — a request that
 * asks for something the provider does not support is rejected with an
 * actionable message, never accepted and then silently ignored.
 *
 * This is the fix for Atlas's `maxSteps` accept-then-ignore: the field was
 * declared on `SubagentSpawnRequest` but never read (the child loop ran a
 * hardcoded 15 turns). Now the descriptor declares the supported step range,
 * `validateSpawnRequest` rejects out-of-range values at spawn time, and the
 * accepted value is threaded all the way to the child turn loop.
 */

/** Default child turn budget when a spawn does not ask for one. */
export const DEFAULT_CHILD_STEPS = 15;
/** Supported inclusive range for requested `maxSteps`. */
export const CHILD_STEP_LIMIT = { min: 1, max: 50 } as const;

/**
 * Static description of what a subagent provider supports. One instance per
 * runtime; handed to the model-facing tools so their prose can state the real
 * limits instead of guessing.
 */
export interface SubagentCapabilities {
  /** Human-readable provider name for errors and tool descriptions. */
  provider: string;
  /**
   * Maximum nesting depth. Root spawns happen at depth 0; a spawn at
   * `depth >= maxDepth` is rejected. Matches the registration gate
   * (`canSpawn`) exactly, so the tool's presence and its execution-time
   * verdict never disagree.
   */
  maxDepth: number;
  /** Global concurrency: how many child tasks may hold a slot at once. */
  maxConcurrent: number;
  /**
   * Whether the provider can run tasks in the background — the spawn returns
   * immediately with an agent id while the child keeps running, and the
   * parent controls it with list/interrupt/output tools.
   */
  supportsBackground: boolean;
  /**
   * Supported inclusive range for `maxSteps` (the child's model-turn budget).
   * A request outside the range is rejected, not clamped — silently clamping
   * is the accept-then-ignore pattern this descriptor exists to prevent.
   */
  stepLimit: { min: number; max: number };
}

/** One concrete reason a spawn request violates the capabilities. */
export interface SpawnCapabilityViolation {
  code: 'depth-exceeded' | 'background-unsupported' | 'max-steps-out-of-range';
  message: string;
}

/** The spawn-request fields the capability check inspects. */
export interface SpawnRequestProbe {
  /** Nesting depth of the task being spawned (root spawn = depth 0). */
  depth?: number;
  /** Whether the caller wants background execution. */
  background?: boolean;
  /** Requested child turn budget. */
  maxSteps?: number;
}

/**
 * Validate one spawn request against the capabilities. Returns every
 * violation (not just the first) so the caller can surface all of them in one
 * actionable error instead of failing one field at a time.
 */
export function validateSpawnRequest(
  capabilities: SubagentCapabilities,
  request: SpawnRequestProbe
): SpawnCapabilityViolation[] {
  const violations: SpawnCapabilityViolation[] = [];

  const depth = request.depth ?? 0;
  // Matches the runtime's spawn-time backstop (`depth > maxDepth`), where
  // `depth` is the spawned task's own depth. A task may exist at depths
  // 0..maxDepth; only a task AT maxDepth is barred from spawning further.
  if (depth > capabilities.maxDepth) {
    violations.push({
      code: 'depth-exceeded',
      message: `Nesting depth ${depth} exceeds the supported maximum (${capabilities.maxDepth}). Delegate the remaining work without spawning deeper agents.`
    });
  }

  if (request.background && !capabilities.supportsBackground) {
    violations.push({
      code: 'background-unsupported',
      message: `${capabilities.provider} does not support background subagents; omit "background" to run the task inline.`
    });
  }

  if (request.maxSteps !== undefined) {
    const { min, max } = capabilities.stepLimit;
    if (!Number.isInteger(request.maxSteps) || request.maxSteps < min || request.maxSteps > max) {
      violations.push({
        code: 'max-steps-out-of-range',
        message: `maxSteps must be an integer between ${min} and ${max} (got ${JSON.stringify(request.maxSteps)}).`
      });
    }
  }

  return violations;
}

/** Render violations into one fail-loud error message. */
export function describeSpawnViolations(violations: SpawnCapabilityViolation[]): string {
  return violations.map((violation) => violation.message).join(' ');
}
