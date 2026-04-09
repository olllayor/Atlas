import { stepCountIs, streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import type { ModelSummary } from '../../../shared/contracts';
import {
  HttpStatusError,
  RequestTimeoutError
} from '../core/ErrorNormalizer';
import type { ProviderAdapter, ProviderStreamRequest, ProviderStreamResult } from '../core/ProviderAdapter';

type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
  };
  supported_parameters?: string[];
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
  archived?: boolean;
};

type OpenRouterModelsResponse = {
  data: OpenRouterModel[];
};

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_FIRST_RESPONSE_TIMEOUT_MS = 300_000;
const OPENROUTER_DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const OPENROUTER_HARD_MAX_OUTPUT_TOKENS = 8192;
const OPENROUTER_TOOL_STEP_LIMIT = 128;

function isZeroPrice(value: string | number | undefined) {
  if (typeof value === 'number') {
    return value === 0;
  }

  if (typeof value === 'string') {
    return Number(value) === 0;
  }

  return false;
}

function buildHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Title': 'Atlas'
  };
}

function resolveMaxOutputTokens(requested: number | undefined) {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return OPENROUTER_DEFAULT_MAX_OUTPUT_TOKENS;
  }

  return Math.max(256, Math.min(Math.floor(requested), OPENROUTER_HARD_MAX_OUTPUT_TOKENS));
}

async function throwForBadResponse(response: Response) {
  if (response.ok) {
    return;
  }

  const body = await response.text();
  throw new HttpStatusError(response.status, body || response.statusText);
}

function normalizeModel(model: OpenRouterModel): ModelSummary {
  const modality = model.architecture?.modality ?? '';
  const inputModalities = model.architecture?.input_modalities ?? [];
  const supportedParameters = model.supported_parameters ?? [];
  const supportsDocumentInput =
    modality.includes('file') ||
    modality.includes('pdf') ||
    inputModalities.some((entry) => /(document|file|pdf)/i.test(entry));

  return {
    id: model.id,
    providerId: 'openrouter',
    label: model.name ?? model.id,
    contextWindow: model.context_length ?? null,
    isFree: model.id.endsWith(':free') || (isZeroPrice(model.pricing?.prompt) && isZeroPrice(model.pricing?.completion)),
    supportsVision:
      modality.includes('image') || inputModalities.some((entry) => entry.includes('image')),
    supportsDocumentInput,
    supportsTools: supportedParameters.some((entry) => entry.includes('tool')),
    archived: Boolean(model.archived),
    lastSyncedAt: new Date().toISOString(),
    lastSeenFreeAt: null
  };
}

export class OpenRouterProvider implements ProviderAdapter {
  readonly providerId = 'openrouter' as const;

  async validateCredential(apiKey: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
        headers: buildHeaders(apiKey),
        signal: controller.signal
      });
      await throwForBadResponse(response);
    } finally {
      clearTimeout(timeout);
    }
  }

  async listModels(apiKey: string | null) {
    if (!apiKey) {
      throw new Error('Add an OpenRouter API key in settings before refreshing models.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
        headers: buildHeaders(apiKey),
        signal: controller.signal
      });
      await throwForBadResponse(response);
      const payload = (await response.json()) as OpenRouterModelsResponse;
      return payload.data.map(normalizeModel);
    } finally {
      clearTimeout(timeout);
    }
  }

  async streamChat(request: ProviderStreamRequest): Promise<ProviderStreamResult> {
    const timeoutController = new AbortController();
    let hasReceivedResponse = false;
    const timeout = setTimeout(() => {
      timeoutController.abort();
    }, OPENROUTER_FIRST_RESPONSE_TIMEOUT_MS);

    const signal = AbortSignal.any([request.signal, timeoutController.signal]);
    const startedAt = Date.now();

    const openrouter = createOpenRouter({
      apiKey: request.apiKey,
      headers: { 'X-Title': 'Atlas' }
    });

    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let reasoningTokens: number | undefined;
    let streamError: unknown;
    const toolNameByCallId = new Map<string, string>();
    const hasTools = request.tools != null && Object.keys(request.tools).length > 0;
    const maxOutputTokens = resolveMaxOutputTokens(request.maxOutputTokens);

    try {
      const result = streamText({
        model: openrouter(request.modelId),
        system: request.system,
        messages: request.messages,
        tools: request.tools,
        toolChoice: request.toolChoice,
        stopWhen: hasTools ? stepCountIs(OPENROUTER_TOOL_STEP_LIMIT) : undefined,
        temperature: request.temperature ?? 0.65,
        maxOutputTokens,
        abortSignal: signal,
        onChunk: ({ chunk }) => {
          if (!hasReceivedResponse) {
            hasReceivedResponse = true;
            clearTimeout(timeout);
          }

          if (chunk.type === 'text-delta') {
            request.onChunk({
              id: chunk.id,
              delta: chunk.text
            });
            return;
          }

          if (chunk.type === 'reasoning-delta') {
            request.onReasoningChunk?.({
              id: chunk.id,
              delta: chunk.text
            });
            return;
          }

          if (chunk.type === 'tool-input-start') {
            request.onToolInputStart?.({
              toolCallId: chunk.id,
              toolName: chunk.toolName,
              dynamic: chunk.dynamic,
              providerExecuted: chunk.providerExecuted,
              title: chunk.title
            });
            return;
          }

          if (chunk.type === 'tool-input-delta') {
            request.onToolInputDelta?.({
              toolCallId: chunk.id,
              delta: chunk.delta
            });
            return;
          }

          if (chunk.type === 'tool-call') {
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
          }

          if (chunk.type === 'tool-result') {
            const deniedOutput =
              chunk.output != null &&
              typeof chunk.output === 'object' &&
              'type' in chunk.output &&
              (chunk.output as { type?: unknown }).type === 'execution-denied';

            if (deniedOutput) {
              request.onToolOutputDenied?.({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName ?? toolNameByCallId.get(chunk.toolCallId),
                reason:
                  typeof (chunk.output as { reason?: unknown }).reason === 'string'
                    ? (chunk.output as { reason: string }).reason
                    : undefined,
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

          const approvalChunk = chunk as {
            type?: unknown;
            approvalId?: unknown;
            toolCallId?: unknown;
            toolCall?: { toolCallId?: unknown; toolName?: unknown };
            reason?: unknown;
          };

          if (
            approvalChunk.type === 'tool-approval-request' &&
            typeof approvalChunk.approvalId === 'string'
          ) {
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
              reason: typeof approvalChunk.reason === 'string' ? approvalChunk.reason : undefined,
            });
            return;
          }
        },
        experimental_onToolCallFinish: ({ success, toolCall, error }) => {
          if (!success) {
            request.onToolOutputError?.({
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              input: toolCall.input,
              errorText: error instanceof Error ? error.message : String(error),
              dynamic: toolCall.dynamic,
              providerExecuted: toolCall.providerExecuted,
              title: toolCall.title
            });
          }
        },
        onFinish: ({ totalUsage }) => {
          if (!totalUsage) {
            return;
          }

          inputTokens = totalUsage.inputTokens;
          outputTokens = totalUsage.outputTokens;
          reasoningTokens = totalUsage.outputTokenDetails.reasoningTokens ?? totalUsage.reasoningTokens;
        },
        onError: ({ error }) => {
          streamError = error;
        },
        providerOptions: {
          openrouter: {
            usage: { include: true }
          }
        }
      });

      // Consume the stream to trigger callbacks
      for await (const _ of result.textStream) {
        // stream consumption drives the pipeline
      }

      // streamText suppresses errors; re-throw if one was captured
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
      if (timeoutController.signal.aborted && !request.signal.aborted && !hasReceivedResponse) {
        throw new RequestTimeoutError();
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
