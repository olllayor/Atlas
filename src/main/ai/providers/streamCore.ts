import { stepCountIs, streamText } from 'ai';
import type { LanguageModel, ModelMessage } from 'ai';

import { estimateMessagesTokens } from '../../../shared/tokenEstimate';
import { ProviderStalledError, RequestTimeoutError } from '../core/ErrorNormalizer';
import type { ProviderStreamRequest, ProviderStreamResult } from '../core/ProviderAdapter';
import { resolveHarnessProfile } from '../core/harnessProfiles';
import {
  createRepeatToolReminderGuard,
  repeatVetoPayload,
  type RepeatToolReminderConfig,
} from '../guards/repeatToolReminder';

/**
 * Hard ceiling applied on top of whatever the model advertises. Providers bill
 * against reserved output budget, so we never request the theoretical maximum.
 */
const ABSOLUTE_MAX_OUTPUT_TOKENS = 32_768;
const MIN_OUTPUT_TOKENS = 256;

/**
 * Upper bound of the wrap-up window, mirroring Claude Code's taskBudget idea:
 * the model is told its remaining tool-step budget so it can finish cleanly
 * instead of dying mid-chain when `stepCountIs()` fires.
 */
const STEP_BUDGET_WARN_MAX = 8;

/**
 * Fraction of the context window that counts as pressure. Matches
 * ContextManager's proactive compaction ratio so the model is warned at the
 * same boundary that already starts dropping older turns.
 */
const CONTEXT_PRESSURE_RATIO = 0.85;

/** Cap for the quoted original instruction in the wrap-up nudge. */
const USER_INSTRUCTION_SNIPPET_CHARS = 400;

/**
 * How many tool steps remain before the harness starts telling the model to
 * wrap up. Always at least 2 so a tiny test limit still gets a chance to
 * finish; never more than STEP_BUDGET_WARN_MAX.
 */
export function stepBudgetWarnWindow(limit: number): number {
  return Math.max(2, Math.min(STEP_BUDGET_WARN_MAX, Math.floor(limit * 0.25)));
}

/**
 * True when this step is inside the wrap-up window (`stepNumber` is 1-based
 * after the first model call, matching AI SDK `prepareStep`).
 */
export function shouldWarnStepBudget(stepNumber: number, limit: number): boolean {
  if (limit <= 0 || stepNumber <= 0) {
    return false;
  }
  return limit - stepNumber <= stepBudgetWarnWindow(limit);
}

/**
 * One-step-only budget reminder. Not persisted into the transcript — same
 * `prepareStep` contract as the repeat-call guard — so it is model-visible
 * for this step and gone from history on the next.
 *
 * When the budget is nearly gone this is a mandate, not a preference: soft
 * "prefer finishing" wording was ignored in mid-size step burns, and the turn
 * died with no user-visible deliverable.
 */
export function buildStepBudgetReminder(
  remaining: number,
  limit: number,
  userInstruction?: string
): ModelMessage {
  const remainingLabel = remaining === 1 ? '1 tool step' : `${remaining} tool steps`;
  const instruction = quoteUserInstruction(userInstruction);
  const text =
    remaining <= 2
      ? `Tool-step budget almost exhausted: ${remainingLabel} of ${limit} remaining this turn. ` +
        `Do not start new work. Do not open more files or run more searches. ` +
        `You MUST now write the user-visible deliverable from what you already have — ` +
        `the grouped index, the summary, or the report the user asked for — as your final reply. ` +
        (instruction
          ? `The original request was:\n${instruction}\nWrite that output now.`
          : `Write the output the user asked for now.`)
      : `Tool-step budget: ${remainingLabel} of ${limit} remaining this turn. ` +
        `Prefer finishing the current thread of work over starting a large new exploration. ` +
        `If the task cannot finish in this budget, report concrete progress and the next steps.` +
        (instruction ? `\n\nOriginal request:\n${instruction}` : '');

  return {
    role: 'user',
    content: [{ type: 'text', text: `<system-reminder>\n${text}\n</system-reminder>` }]
  };
}

function quoteUserInstruction(userInstruction: string | undefined): string | null {
  const trimmed = userInstruction?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= USER_INSTRUCTION_SNIPPET_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, USER_INSTRUCTION_SNIPPET_CHARS)}…`;
}

/**
 * True when estimated prompt size has crossed the pressure boundary. Absent
 * or unknown windows never warn — the cost of a false positive is a confused
 * model mid-task, and an unknown window cannot be measured.
 */
export function shouldWarnContextPressure(
  estimatedTokens: number,
  contextWindow: number | undefined | null,
  ratio = CONTEXT_PRESSURE_RATIO
): boolean {
  if (contextWindow == null || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return false;
  }
  return estimatedTokens >= contextWindow * ratio;
}

/**
 * One-step-only context-pressure nudge. Same non-persisted `prepareStep`
 * contract as the step-budget reminder: visible now, gone next step.
 */
export function buildContextPressureReminder(
  estimatedTokens: number,
  contextWindow: number
): ModelMessage {
  const percent = Math.min(100, Math.round((estimatedTokens / contextWindow) * 100));
  const text =
    `Context is nearly full (~${percent}% of this model's window). ` +
    `Do not open large files or dump long tool output into the conversation. ` +
    `Write a short index of what you already have into a file if the task needs one, ` +
    `prefer compact answers, and finish the current deliverable instead of expanding scope.`;

  return {
    role: 'user',
    content: [{ type: 'text', text: `<system-reminder>\n${text}\n</system-reminder>` }]
  };
}

export type StreamCoreConfig = {
  /** Fallback ceiling when the catalog has no per-model figure. */
  defaultMaxOutputTokens: number;
  /** Maximum tool-calling round trips in a single turn. */
  toolStepLimit: number;
  /** How long to wait for the first byte before declaring a timeout. */
  firstResponseTimeoutMs: number;
  /**
   * How long the stream may go silent *after* it has started before we treat
   * it as dead. Without this a half-open connection hangs the turn forever.
   */
  idleTimeoutMs: number;
  defaultTemperature: number;
};

export const DEFAULT_STREAM_CORE_CONFIG: StreamCoreConfig = {
  defaultMaxOutputTokens: 8_192,
  toolStepLimit: 64,
  firstResponseTimeoutMs: 180_000,
  // Must stay above the longest local tool run (the bash tool caps at 120s),
  // otherwise a healthy tool call looks like a dead stream.
  idleTimeoutMs: 180_000,
  defaultTemperature: 0.65
};

/**
 * Sizes the completion budget to the model rather than to the provider. The
 * previous per-provider constant capped every model at 8k and silently
 * truncated long answers from models that allow far more.
 */
export function resolveMaxOutputTokens(
  requested: number | undefined,
  hints: ProviderStreamRequest['modelHints'],
  config: Pick<StreamCoreConfig, 'defaultMaxOutputTokens'>
) {
  const advertised = hints?.maxOutputTokens;
  let ceiling =
    typeof advertised === 'number' && Number.isFinite(advertised) && advertised > 0
      ? advertised
      : config.defaultMaxOutputTokens;

  ceiling = Math.min(ceiling, ABSOLUTE_MAX_OUTPUT_TOKENS);

  // Providers that bill output against the same window as the prompt will
  // reject a request that reserves most of it, so leave room for the input.
  const contextWindow = hints?.contextWindow;
  if (typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0) {
    ceiling = Math.min(ceiling, Math.max(1_024, Math.floor(contextWindow / 2)));
  }

  ceiling = Math.max(MIN_OUTPUT_TOKENS, Math.floor(ceiling));

  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return ceiling;
  }

  return Math.max(MIN_OUTPUT_TOKENS, Math.min(Math.floor(requested), ceiling));
}

/**
 * Reasoning models reject `temperature` outright. Sending it anyway turns a
 * working model into a hard 400, so the catalog decides.
 */
export function resolveTemperature(
  requested: number | undefined,
  hints: ProviderStreamRequest['modelHints'],
  config: Pick<StreamCoreConfig, 'defaultTemperature'>
) {
  if (hints?.supportsTemperature === false) {
    return undefined;
  }

  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.max(0, Math.min(requested, 2));
  }

  return config.defaultTemperature;
}

export type WatchdogState = {
  signal: AbortSignal;
  hasReceivedResponse: () => boolean;
  dispose: () => void;
  touch: () => void;
};

/**
 * Single re-armed timer covering both "never started" and "went silent" — the
 * second case had no coverage before and left turns hanging indefinitely.
 */
export function createWatchdog(
  config: Pick<StreamCoreConfig, 'firstResponseTimeoutMs' | 'idleTimeoutMs'>
): WatchdogState {
  const controller = new AbortController();
  let received = false;
  let timer: NodeJS.Timeout | null = null;

  const arm = (ms: number) => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      controller.abort();
    }, ms);
    timer.unref?.();
  };

  arm(config.firstResponseTimeoutMs);

  return {
    signal: controller.signal,
    hasReceivedResponse: () => received,
    touch: () => {
      received = true;
      arm(config.idleTimeoutMs);
    },
    dispose: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
  };
}

type StreamTextProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>;

export type StreamCoreOptions = {
  model: LanguageModel;
  request: ProviderStreamRequest;
  config?: Partial<StreamCoreConfig>;
  providerOptions?: StreamTextProviderOptions;
  /**
   * Repeat-call guard configuration; `false` disables the guard entirely.
   * Defaults to the guard's own defaults (thresholds [3, 5, 8]).
   */
  repeatToolReminder?: RepeatToolReminderConfig | false;
};

type WrapUpResult = {
  content: string;
  reasoning: string | undefined;
  responseMessages: ModelMessage[];
  outputTokens: number | undefined;
  reasoningTokens: number | undefined;
};

/**
 * One tool-free completion after the step budget dies mid-tool-chain.
 * Failures are swallowed: a failed wrap-up must not discard the work the
 * main stream already produced.
 */
async function runTextOnlyWrapUp({
  model,
  system,
  messages,
  temperature,
  maxOutputTokens,
  signal,
  onChunk,
  onReasoningChunk,
}: {
  model: LanguageModel;
  system: string | undefined;
  messages: ModelMessage[];
  temperature: number | undefined;
  maxOutputTokens: number;
  signal: AbortSignal;
  onChunk: ProviderStreamRequest['onChunk'];
  onReasoningChunk: ProviderStreamRequest['onReasoningChunk'];
}): Promise<WrapUpResult | null> {
  try {
    let streamError: unknown;
    let outputTokens: number | undefined;
    let reasoningTokens: number | undefined;

    const wrapUp = streamText({
      model,
      system,
      messages: [
        ...messages,
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                '<system-reminder>\n' +
                'Tool-step budget is exhausted. Do not call tools. ' +
                'Write the final user-visible summary or deliverable from what you already produced.\n' +
                '</system-reminder>',
            },
          ],
        },
      ],
      toolChoice: 'none',
      temperature,
      maxOutputTokens,
      abortSignal: signal,
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          onChunk({ id: chunk.id, delta: chunk.text });
          return;
        }
        if (chunk.type === 'reasoning-delta') {
          onReasoningChunk?.({ id: chunk.id, delta: chunk.text });
        }
      },
      onFinish: ({ totalUsage }) => {
        if (!totalUsage) {
          return;
        }
        outputTokens = totalUsage.outputTokens;
        reasoningTokens = totalUsage.outputTokenDetails?.reasoningTokens ?? totalUsage.reasoningTokens;
      },
      onError: ({ error }) => {
        streamError = error;
      },
    });

    await wrapUp.consumeStream();
    if (streamError) {
      return null;
    }

    const content = await wrapUp.text;
    if (!content?.trim()) {
      return null;
    }

    return {
      content,
      reasoning: await wrapUp.reasoningText,
      responseMessages: (await wrapUp.response).messages,
      outputTokens,
      reasoningTokens,
    };
  } catch {
    return null;
  }
}

/**
 * The one implementation of provider streaming. Every adapter supplies a model
 * plus provider-specific options; chunk fan-out, usage capture, watchdogs and
 * error surfacing are identical and live here.
 */
export async function runProviderStream({
  model,
  request,
  config: configOverrides,
  providerOptions,
  repeatToolReminder
}: StreamCoreOptions): Promise<ProviderStreamResult> {
  const config = { ...DEFAULT_STREAM_CORE_CONFIG, ...configOverrides };
  // Model-specific ceiling (v1 heuristic): never exceeds configured cap, only
  // tightens it for lightweight models that rarely sustain long chains. A
  // `null` limit means the profile has no opinion, so the configured cap stands.
  const profile = resolveHarnessProfile(request.modelId ?? '');
  const effectiveStepLimit =
    profile.toolStepLimit === null
      ? config.toolStepLimit
      : Math.min(config.toolStepLimit, profile.toolStepLimit);
  const watchdog = createWatchdog(config);
  const signal = AbortSignal.any([request.signal, watchdog.signal]);
  const startedAt = Date.now();

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let reasoningTokens: number | undefined;
  let cachedInputTokens: number | undefined;
  let streamError: unknown;

  const toolNameByCallId = new Map<string, string>();
  const hasTools = request.tools != null && Object.keys(request.tools).length > 0;
  const maxOutputTokens = resolveMaxOutputTokens(request.maxOutputTokens, request.modelHints, config);
  const temperature = resolveTemperature(request.temperature, request.modelHints, config);

  // Advisory loop-breaker: counts consecutive identical tool calls and, past
  // the thresholds, nudges the model on the next step. One guard per stream —
  // a stream is one turn for one conversation, so chains never leak across
  // turns or into subagents (which run their own streams).
  const repeatGuard =
    hasTools && repeatToolReminder !== false
      ? createRepeatToolReminderGuard(repeatToolReminder ?? {})
      : undefined;

  // Post-execute observation point: `tool-result` chunks fire for executed and
  // denied calls; calls whose execute threw surface only through
  // `experimental_onToolCallFinish` below (the SDK filters `tool-error` out of
  // onChunk). Both are attempts worth counting, exactly like dsh's
  // `tools/post-execute`.
  const observeRepeat = (toolName: string | undefined, input: unknown) => {
    const reminder = repeatGuard?.observe({ toolName, input });
    if (!reminder) {
      return;
    }

    request.onNotice?.({
      code: 'repeat-tool-reminder',
      level: 'info',
      message: `Repeated ${reminder.summary} — nudged the model to change approach.`
    });
  };

  // Pre-execute veto: wrap every tool so a run past VETO_THRESHOLD never
  // executes again — the model gets the veto payload as the result instead.
  // The vetoed attempt still flows through `tool-result` above, so the chain
  // keeps counting and the block persists while the model keeps retrying.
  const vetoWrappedTools = (() => {
    if (!repeatGuard || !request.tools) {
      return request.tools;
    }
    const wrapped: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(request.tools)) {
      const toolDef = def as { execute?: (...args: never[]) => Promise<unknown> };
      if (!toolDef || typeof toolDef.execute !== 'function') {
        wrapped[name] = def;
        continue;
      }
      const originalExecute = toolDef.execute.bind(toolDef);
      wrapped[name] = {
        ...toolDef,
        execute: async (...args: never[]) => {
          const input = args[0] as unknown;
          if (repeatGuard.shouldBlock(name, input)) {
            const count = repeatGuard.peekCount(name, input) + 1;
            request.onNotice?.({
              code: 'repeat-veto',
              level: 'warning',
              message: `Blocked ${name} × ${count} — identical call vetoed, not executed.`
            });
            return repeatVetoPayload(name, count);
          }
          return originalExecute(...args);
        }
      };
    }
    return wrapped as typeof request.tools;
  })();

  try {
    const result = streamText({
      model,
      system: request.system,
      messages: request.messages,
      tools: vetoWrappedTools,
      toolChoice: request.toolChoice,
      stopWhen: hasTools ? stepCountIs(effectiveStepLimit) : undefined,
      // Delivery point for step-local nudges: repeat-call reminders, the
      // wrap-up budget, and context pressure. Overrides are not merged into
      // response.messages, so each nudge is model-visible for one step and
      // never persisted.
      prepareStep: hasTools
        ? ({ messages, stepNumber }) => {
            if (stepNumber === 0) {
              return {};
            }

            let next = messages;
            if (repeatGuard) {
              next = repeatGuard.injectIntoStepMessages(next);
            }

            if (shouldWarnStepBudget(stepNumber, effectiveStepLimit)) {
              const remaining = Math.max(0, effectiveStepLimit - stepNumber);
              next = [
                ...next,
                buildStepBudgetReminder(remaining, effectiveStepLimit, request.userInstruction),
              ];
            }

            const contextWindow = request.modelHints?.contextWindow;
            if (contextWindow != null && contextWindow > 0) {
              const fixedFloor = request.fixedFloorTokens ?? 0;
              const estimated = estimateMessagesTokens(next) + fixedFloor;
              if (shouldWarnContextPressure(estimated, contextWindow)) {
                next = [...next, buildContextPressureReminder(estimated, contextWindow)];
              }
            }

            return next === messages ? {} : { messages: next };
          }
        : undefined,
      temperature,
      maxOutputTokens,
      abortSignal: signal,
      providerOptions,
      onChunk: ({ chunk }) => {
        watchdog.touch();

        switch (chunk.type) {
          case 'text-delta':
            request.onChunk({ id: chunk.id, delta: chunk.text });
            return;

          case 'reasoning-delta':
            request.onReasoningChunk?.({ id: chunk.id, delta: chunk.text });
            return;

          case 'tool-input-start':
            request.onToolInputStart?.({
              toolCallId: chunk.id,
              toolName: chunk.toolName,
              dynamic: chunk.dynamic,
              providerExecuted: chunk.providerExecuted,
              title: chunk.title
            });
            return;

          case 'tool-input-delta':
            request.onToolInputDelta?.({ toolCallId: chunk.id, delta: chunk.delta });
            return;

          case 'tool-call':
            toolNameByCallId.set(chunk.toolCallId, chunk.toolName);
            request.onToolInputAvailable?.({
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              input: chunk.input,
              dynamic: chunk.dynamic,
              providerExecuted: chunk.providerExecuted,
              title: chunk.title
            });
            return;

          case 'tool-result': {
            const output = chunk.output as { type?: unknown; reason?: unknown } | null | undefined;
            const denied = output != null && typeof output === 'object' && output.type === 'execution-denied';

            // Count denied attempts too: a model hammering a call the approval
            // ladder refuses is exactly the loop worth breaking. Preliminary
            // (streaming) results are skipped so one execution counts once.
            if (!chunk.preliminary) {
              observeRepeat(chunk.toolName ?? toolNameByCallId.get(chunk.toolCallId), chunk.input);
            }

            if (denied) {
              request.onToolOutputDenied?.({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName ?? toolNameByCallId.get(chunk.toolCallId),
                reason: typeof output.reason === 'string' ? output.reason : undefined
              });
              return;
            }

            request.onToolOutputAvailable?.({
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              input: chunk.input,
              output: chunk.output,
              dynamic: chunk.dynamic,
              preliminary: chunk.preliminary,
              providerExecuted: chunk.providerExecuted,
              title: chunk.title
            });
            return;
          }

          default:
            break;
        }

        const approvalChunk = chunk as {
          type?: unknown;
          approvalId?: unknown;
          toolCallId?: unknown;
          toolCall?: { toolCallId?: unknown; toolName?: unknown };
          reason?: unknown;
        };

        if (approvalChunk.type !== 'tool-approval-request' || typeof approvalChunk.approvalId !== 'string') {
          return;
        }

        const approvalToolCallId =
          typeof approvalChunk.toolCallId === 'string'
            ? approvalChunk.toolCallId
            : typeof approvalChunk.toolCall?.toolCallId === 'string'
              ? approvalChunk.toolCall.toolCallId
              : null;

        if (!approvalToolCallId) {
          return;
        }

        request.onToolApprovalRequested?.({
          approvalId: approvalChunk.approvalId,
          toolCallId: approvalToolCallId,
          toolName:
            toolNameByCallId.get(approvalToolCallId) ??
            (typeof approvalChunk.toolCall?.toolName === 'string' ? approvalChunk.toolCall.toolName : undefined),
          reason: typeof approvalChunk.reason === 'string' ? approvalChunk.reason : undefined
        });
      },
      experimental_onToolCallFinish: ({ success, toolCall, error }) => {
        // Local tool execution can outlast the idle window; keep the watchdog
        // fed so a slow-but-healthy tool call is not mistaken for a dead stream.
        watchdog.touch();

        if (success) {
          return;
        }

        // A call whose execute threw is still an attempt; count it so a model
        // re-issuing a crashing call gets the same nudge. Errored calls never
        // reach onChunk (the SDK filters `tool-error` out), so this callback is
        // the only observation point for them.
        observeRepeat(toolCall.toolName, toolCall.input);

        request.onToolOutputError?.({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: toolCall.input,
          errorText: error instanceof Error ? error.message : String(error),
          dynamic: toolCall.dynamic,
          providerExecuted: toolCall.providerExecuted,
          title: toolCall.title
        });
      },
      onFinish: ({ totalUsage }) => {
        if (!totalUsage) {
          return;
        }

        inputTokens = totalUsage.inputTokens;
        outputTokens = totalUsage.outputTokens;
        reasoningTokens = totalUsage.outputTokenDetails?.reasoningTokens ?? totalUsage.reasoningTokens;
        // Provider-reported prefix-cache hits (OpenAI-compat
        // `prompt_tokens_details.cached_tokens`, Anthropic
        // `cache_read_input_tokens`; the SDK normalizes both). Absent when the
        // provider does not report it — absence is meaningful and is preserved.
        cachedInputTokens = totalUsage.cachedInputTokens;
      },
      onError: ({ error }) => {
        streamError = error;
      }
    });

    // Drains every part type without materialising a text stream we discard.
    await result.consumeStream();

    // streamText swallows stream errors; re-throw whatever onError captured.
    if (streamError) {
      throw streamError;
    }

    // Step-budget exhaustion is otherwise silent: `stepCountIs()` just stops,
    // and the turn reads as the model giving up mid-task. Say so explicitly so
    // the user can continue rather than wonder. Guarded — mocks and future SDK
    // shapes without `steps` must not fail a healthy turn.
    let content = await result.text;
    let reasoning = await result.reasoningText;
    let responseMessages = (await result.response).messages;

    if (hasTools) {
      try {
        const finishedSteps = await (result as unknown as { steps?: PromiseLike<unknown[]> }).steps;
        if (Array.isArray(finishedSteps) && finishedSteps.length >= effectiveStepLimit) {
          request.onNotice?.({
            code: 'step-limit-exhausted',
            level: 'warning',
            message: `Reached the step limit (${effectiveStepLimit} tool steps). Progress so far is above — reply "continue" to pick up where it stopped.`
          });

          // Claude Code analogue: when the budget dies mid-tool-chain, force
          // one text-only follow-up so the turn still ends with a deliverable
          // instead of an empty tail after a wall of tool calls.
          const lastStep = finishedSteps[finishedSteps.length - 1] as
            | { toolCalls?: unknown[] }
            | undefined;
          const lastHadTools = Array.isArray(lastStep?.toolCalls) && lastStep.toolCalls.length > 0;
          if (lastHadTools && !signal.aborted) {
            const wrapUp = await runTextOnlyWrapUp({
              model,
              system: request.system,
              messages: [...request.messages, ...responseMessages],
              temperature,
              maxOutputTokens: Math.min(maxOutputTokens, 4_096),
              signal,
              onChunk: request.onChunk,
              onReasoningChunk: request.onReasoningChunk,
            });
            if (wrapUp) {
              content = wrapUp.content;
              reasoning = wrapUp.reasoning;
              // The SDK's response.messages is a narrower assistant/tool union;
              // the wrap-up messages are ordinary assistant turns.
              responseMessages = wrapUp.responseMessages as typeof responseMessages;
              outputTokens = (outputTokens ?? 0) + (wrapUp.outputTokens ?? 0);
              reasoningTokens = (reasoningTokens ?? 0) + (wrapUp.reasoningTokens ?? 0);
            }
          }
        }
      } catch {
        // Steps unavailable; the turn itself succeeded, so stay silent.
      }
    }

    return {
      content,
      reasoning,
      responseMessages,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cachedInputTokens,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    if (watchdog.signal.aborted && !request.signal.aborted) {
      throw watchdog.hasReceivedResponse() ? new ProviderStalledError() : new RequestTimeoutError();
    }

    throw error;
  } finally {
    watchdog.dispose();
  }
}
