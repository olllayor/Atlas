import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import type { ChatInputMessage, ModelSummary } from '../../../shared/contracts';
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
    'X-Title': 'CheapChat'
  };
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

  return {
    id: model.id,
    providerId: 'openrouter',
    label: model.name ?? model.id,
    contextWindow: model.context_length ?? null,
    isFree: model.id.endsWith(':free') || (isZeroPrice(model.pricing?.prompt) && isZeroPrice(model.pricing?.completion)),
    supportsVision:
      modality.includes('image') || inputModalities.some((entry) => entry.includes('image')),
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

  async listModels(apiKey: string) {
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
    const timeout = setTimeout(() => {
      timeoutController.abort();
    }, 45_000);

    const signal = AbortSignal.any([request.signal, timeoutController.signal]);
    const startedAt = Date.now();

    const openrouter = createOpenRouter({
      apiKey: request.apiKey,
      headers: { 'X-Title': 'CheapChat' }
    });

    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let streamError: unknown;

    try {
      const result = streamText({
        model: openrouter(request.modelId),
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
