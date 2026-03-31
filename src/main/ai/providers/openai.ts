import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import type { ChatInputMessage, ModelSummary } from '../../../shared/contracts';
import {
  HttpStatusError,
  RequestTimeoutError
} from '../core/ErrorNormalizer';
import type { ProviderAdapter, ProviderStreamRequest, ProviderStreamResult } from '../core/ProviderAdapter';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

const VISION_MODELS = [
  'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4-vision',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano'
];

const TOOL_MODELS = [
  'gpt-4', 'gpt-4-turbo', 'gpt-4o', 'gpt-4o-mini',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano'
];

function isFreeOrCheapModel(modelId: string) {
  return modelId.includes('nano') || modelId.includes('mini') || modelId.endsWith(':free');
}

function normalizeModel(model: { id: string; name?: string; context_length?: number }, providerId: 'openai'): ModelSummary {
  const modelId = model.id.replace(/^openai\//, '').replace(/^ft:/, 'ft:');

  return {
    id: modelId,
    providerId,
    label: model.name ?? modelId,
    contextWindow: model.context_length ?? null,
    isFree: isFreeOrCheapModel(modelId),
    supportsVision: VISION_MODELS.some((vm) => modelId.startsWith(vm) || modelId.includes(vm)),
    supportsTools: TOOL_MODELS.some((tm) => modelId.startsWith(tm) || modelId.includes(tm)),
    archived: false,
    lastSyncedAt: new Date().toISOString(),
    lastSeenFreeAt: null
  };
}

export class OpenAIProvider implements ProviderAdapter {
  readonly providerId = 'openai' as const;

  async validateCredential(apiKey: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${OPENAI_BASE_URL}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
      const response = await fetch(`${OPENAI_BASE_URL}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new HttpStatusError(response.status, body || response.statusText);
      }

      const payload = await response.json() as { data: Array<{ id: string; name?: string; context_length?: number }> };
      return payload.data
        .filter((m) => m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3') || m.id.startsWith('o4') || m.id.startsWith('ft:'))
        .map((m) => normalizeModel(m, 'openai'));
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

    const openai = createOpenAI({
      apiKey: request.apiKey
    });

    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let streamError: unknown;

    try {
      const result = streamText({
        model: openai(request.modelId),
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
