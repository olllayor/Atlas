import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

import type { ChatInputMessage, ModelSummary } from '../../../shared/contracts';
import {
  HttpStatusError,
  RequestTimeoutError
} from '../core/ErrorNormalizer';
import type { ProviderAdapter, ProviderStreamRequest, ProviderStreamResult } from '../core/ProviderAdapter';

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

const VISION_MODELS = [
  'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku',
  'claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-3-7-sonnet',
  'claude-4-sonnet', 'claude-4-opus'
];

const TOOL_MODELS = [
  'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku',
  'claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-3-7-sonnet',
  'claude-4-sonnet', 'claude-4-opus'
];

function isFreeOrCheapModel(modelId: string) {
  return modelId.includes('haiku') || modelId.endsWith(':free');
}

function normalizeModel(model: { id: string; name?: string; context_length?: number; capabilities?: { input_modalities?: string[] } }): ModelSummary {
  const modelId = model.id;
  const inputModalities = model.capabilities?.input_modalities ?? [];

  return {
    id: modelId,
    providerId: 'anthropic' as const,
    label: model.name ?? modelId,
    contextWindow: model.context_length ?? null,
    isFree: isFreeOrCheapModel(modelId),
    supportsVision:
      VISION_MODELS.some((vm) => modelId.startsWith(vm)) ||
      inputModalities.some((entry) => entry.includes('image')),
    supportsTools: TOOL_MODELS.some((tm) => modelId.startsWith(tm)),
    archived: false,
    lastSyncedAt: new Date().toISOString(),
    lastSeenFreeAt: null
  };
}

export class AnthropicProvider implements ProviderAdapter {
  readonly providerId = 'anthropic' as const;

  async validateCredential(apiKey: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${ANTHROPIC_BASE_URL}/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new HttpStatusError(response.status, body || response.statusText);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async listModels(apiKey: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(`${ANTHROPIC_BASE_URL}/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new HttpStatusError(response.status, body || response.statusText);
      }

      const payload = await response.json() as { data: Array<{ id: string; name?: string; context_length?: number; capabilities?: { input_modalities?: string[] } }> };
      return payload.data
        .filter((m) => m.id.startsWith('claude-'))
        .map((m) => normalizeModel(m));
    } finally {
      clearTimeout(timeout);
    }
  }

  async streamChat(request: ProviderStreamRequest): Promise<ProviderStreamResult> {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => {
      timeoutController.abort();
    }, 45_000);

    const signal = AbortSignal.any([request.signal, timeoutController.signal]);
    const startedAt = Date.now();

    const anthropic = createAnthropic({
      apiKey: request.apiKey
    });

    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let streamError: unknown;

    try {
      const result = streamText({
        model: anthropic(request.modelId),
        messages: request.messages.map((m: ChatInputMessage) => ({
          role: m.role,
          content: m.content
        })),
        temperature: request.temperature ?? 0.65,
        maxOutputTokens: request.maxOutputTokens,
        abortSignal: signal,
        onChunk: ({ chunk }) => {
          if (chunk.type === 'text-delta') {
            request.onChunk(chunk.text);
          }
        },
        onFinish: ({ usage }) => {
          inputTokens = usage.inputTokens;
          outputTokens = usage.outputTokens;
        },
        onError: ({ error }) => {
          streamError = error;
        }
      });

      for await (const _ of result.textStream) {
        // stream consumption drives the pipeline
      }

      if (streamError) {
        throw streamError;
      }

      return {
        content: await result.text,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      if (timeoutController.signal.aborted && !request.signal.aborted) {
        throw new RequestTimeoutError();
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
