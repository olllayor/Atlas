import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

import type { ChatInputMessage, ModelSummary } from '../../../shared/contracts';
import {
  HttpStatusError,
  RequestTimeoutError
} from '../core/ErrorNormalizer';
import type { ProviderAdapter, ProviderStreamRequest, ProviderStreamResult } from '../core/ProviderAdapter';

const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const VISION_MODELS = [
  'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash',
  'gemini-2.5-pro', 'gemini-2.5-flash'
];

const TOOL_MODELS = [
  'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash',
  'gemini-2.5-pro', 'gemini-2.5-flash'
];

function isFreeOrCheapModel(modelId: string) {
  return modelId.includes('flash') || modelId.endsWith(':free');
}

function normalizeModel(model: { name: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }): ModelSummary | null {
  const rawId = model.name.replace(/^models\//, '');
  const modelId = rawId.replace(/-\d+$/, '');

  const hasVision = VISION_MODELS.some((vm) => modelId.startsWith(vm));
  const hasTools = TOOL_MODELS.some((tm) => modelId.startsWith(tm));
  const supportsGeneration = model.supportedGenerationMethods?.includes('streamGenerateContent') ?? false;

  if (!supportsGeneration) {
    return null;
  }

  return {
    id: modelId,
    providerId: 'gemini' as const,
    label: model.displayName ?? modelId,
    contextWindow: model.inputTokenLimit ?? null,
    isFree: isFreeOrCheapModel(modelId),
    supportsVision: hasVision,
    supportsTools: hasTools,
    archived: false,
    lastSyncedAt: new Date().toISOString(),
    lastSeenFreeAt: null
  };
}

export class GeminiProvider implements ProviderAdapter {
  readonly providerId = 'gemini' as const;

  async validateCredential(apiKey: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${GOOGLE_BASE_URL}/models?key=${apiKey}`, {
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
      const response = await fetch(`${GOOGLE_BASE_URL}/models?key=${apiKey}`, {
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new HttpStatusError(response.status, body || response.statusText);
      }

      const payload = await response.json() as { models: Array<{ name: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }> };
      return payload.models
        .filter((m) => m.name.startsWith('models/gemini-'))
        .map((m) => normalizeModel(m))
        .filter((m): m is ModelSummary => m !== null);
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

    const google = createGoogleGenerativeAI({
      apiKey: request.apiKey
    });

    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let streamError: unknown;

    try {
      const result = streamText({
        model: google(request.modelId),
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
