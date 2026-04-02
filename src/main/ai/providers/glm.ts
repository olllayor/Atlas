import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';

import { getGlmSeedModels } from '../../../shared/providerCatalogs';
import {
  HttpStatusError,
  RequestTimeoutError
} from '../core/ErrorNormalizer';
import type { ProviderAdapter, ProviderStreamRequest, ProviderStreamResult } from '../core/ProviderAdapter';

const GLM_BASE_URL = 'https://api.z.ai/api/paas/v4';
const GLM_FIRST_RESPONSE_TIMEOUT_MS = 300_000;
const GLM_DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const GLM_HARD_MAX_OUTPUT_TOKENS = 8192;

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

    try {
      const result = streamText({
        model: glm(request.modelId),
        system: request.system,
        messages: request.messages,
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
