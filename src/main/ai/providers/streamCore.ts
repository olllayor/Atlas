import { stepCountIs, streamText } from 'ai';
import type { LanguageModel } from 'ai';

import { ProviderStalledError, RequestTimeoutError } from '../core/ErrorNormalizer';
import type { ProviderStreamRequest, ProviderStreamResult } from '../core/ProviderAdapter';
import {
  createRepeatToolReminderGuard,
  type RepeatToolReminderConfig
} from '../guards/repeatToolReminder';

/**
 * Hard ceiling applied on top of whatever the model advertises. Providers bill
 * against reserved output budget, so we never request the theoretical maximum.
 */
const ABSOLUTE_MAX_OUTPUT_TOKENS = 32_768;
const MIN_OUTPUT_TOKENS = 256;

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
  toolStepLimit: 128,
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
  const watchdog = createWatchdog(config);
  const signal = AbortSignal.any([request.signal, watchdog.signal]);
  const startedAt = Date.now();

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let reasoningTokens: number | undefined;
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

  try {
    const result = streamText({
      model,
      system: request.system,
      messages: request.messages,
      tools: request.tools,
      toolChoice: request.toolChoice,
      stopWhen: hasTools ? stepCountIs(config.toolStepLimit) : undefined,
      // Delivery point for the repeat-call guard: when a reminder is queued,
      // append it after the previous step's tool results for this step only.
      // The override is not merged into response.messages, so the nudge is
      // model-visible for one step and never persisted to the transcript.
      prepareStep: repeatGuard
        ? ({ messages, stepNumber }) => {
            if (stepNumber === 0) {
              return {};
            }

            const injected = repeatGuard.injectIntoStepMessages(messages);
            return injected === messages ? {} : { messages: injected };
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

    return {
      content: await result.text,
      reasoning: await result.reasoningText,
      responseMessages: (await result.response).messages,
      inputTokens,
      outputTokens,
      reasoningTokens,
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
