import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { stepCountIs, streamText } from 'ai';

import { getGlmSeedModels } from '../../../shared/providerCatalogs';
import {
  HttpStatusError,
  RequestTimeoutError
} from '../core/ErrorNormalizer';
import type { ProviderAdapter, ProviderStreamRequest, ProviderStreamResult } from '../core/ProviderAdapter';

const GLM_BASE_URL = 'https://api.z.ai/api/paas/v4';
const GLM_FIRST_RESPONSE_TIMEOUT_MS = 300_000;
const GLM_DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const GLM_HARD_MAX_OUTPUT_TOKENS = 8192;
const GLM_TOOL_STEP_LIMIT = 128;

function buildHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Accept-Language': 'en-US,en',
    'Content-Type': 'application/json'
  };
}

function resolveMaxOutputTokens(requested: number | undefined) {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return GLM_DEFAULT_MAX_OUTPUT_TOKENS;
  }

  return Math.max(256, Math.min(Math.floor(requested), GLM_HARD_MAX_OUTPUT_TOKENS));
}

async function throwForBadResponse(response: Response) {
  if (response.ok) {
    return;
  }

  const body = await response.text();
  throw new HttpStatusError(response.status, body || response.statusText);
}

export class GlmProvider implements ProviderAdapter {
  readonly providerId = 'glm' as const;

  async validateCredential(apiKey: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(`${GLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(apiKey),
        body: JSON.stringify({
          model: 'glm-4.5-flash',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 1
        }),
        signal: controller.signal
      });

      await throwForBadResponse(response);
    } finally {
      clearTimeout(timeout);
    }
  }

  async listModels() {
    return getGlmSeedModels();
  }

  async streamChat(request: ProviderStreamRequest): Promise<ProviderStreamResult> {
    const timeoutController = new AbortController();
    let hasReceivedResponse = false;
    const timeout = setTimeout(() => {
      timeoutController.abort();
    }, GLM_FIRST_RESPONSE_TIMEOUT_MS);

    const signal = AbortSignal.any([request.signal, timeoutController.signal]);
    const startedAt = Date.now();
    const maxOutputTokens = resolveMaxOutputTokens(request.maxOutputTokens);

    const glm = createOpenAICompatible({
      name: 'glm',
      apiKey: request.apiKey,
      baseURL: GLM_BASE_URL
    });

    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let reasoningTokens: number | undefined;
    let streamError: unknown;
    const toolNameByCallId = new Map<string, string>();
    const hasTools = request.tools != null && Object.keys(request.tools).length > 0;

    try {
      const result = streamText({
        model: glm(request.modelId),
        system: request.system,
        messages: request.messages,
        tools: request.tools,
        toolChoice: request.toolChoice,
        stopWhen: hasTools ? stepCountIs(GLM_TOOL_STEP_LIMIT) : undefined,
        providerOptions: {
          glm: {
            thinking: {
              type: 'disabled'
            }
          }
        },
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
              title: chunk.title,
            });
            return;
          }

          if (chunk.type === 'tool-input-delta') {
            request.onToolInputDelta?.({
              toolCallId: chunk.id,
              delta: chunk.delta,
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
              title: chunk.title,
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
              title: chunk.title,
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
              title: toolCall.title,
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
        }
      });

      for await (const _ of result.textStream) {
        // stream consumption drives callbacks
      }

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
