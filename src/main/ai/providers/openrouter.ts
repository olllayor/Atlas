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

function buildChatBody(request: ProviderStreamRequest) {
  return {
    model: request.modelId,
    messages: request.messages.map((message: ChatInputMessage) => ({
      role: message.role,
      content: message.content
    })),
    temperature: request.temperature ?? 0.65,
    max_tokens: request.maxOutputTokens,
    stream: true,
    stream_options: {
      include_usage: true
    }
  };
}

function parseStreamEvent(
  rawEvent: string,
  onChunk: (delta: string) => void,
  content: { value: string },
  usage: { inputTokens?: number; outputTokens?: number }
) {
  const data = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();

  if (!data) {
    return { done: false };
  }

  if (data === '[DONE]') {
    return { done: true };
  }

  const payload = JSON.parse(data);
  const delta = payload.choices?.[0]?.delta?.content ?? '';

  if (typeof delta === 'string' && delta.length > 0) {
    content.value += delta;
    onChunk(delta);
  }

  if (payload.usage) {
    usage.inputTokens = payload.usage.prompt_tokens ?? usage.inputTokens;
    usage.outputTokens = payload.usage.completion_tokens ?? usage.outputTokens;
  }

  return { done: false };
}

export class OpenRouterProvider implements ProviderAdapter {
  readonly providerId = 'openrouter' as const;
  private readonly baseUrl = 'https://openrouter.ai/api/v1';

  async validateCredential(apiKey: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
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
      const response = await fetch(`${this.baseUrl}/models`, {
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

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(request.apiKey),
        body: JSON.stringify(buildChatBody(request)),
        signal
      });

      await throwForBadResponse(response);

      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('OpenRouter did not return a readable stream.');
      }

      const decoder = new TextDecoder();
      const content = { value: '' };
      const usage: { inputTokens?: number; outputTokens?: number } = {};
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let boundaryIndex = buffer.indexOf('\n\n');
        while (boundaryIndex >= 0) {
          const rawEvent = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);

          const eventState = parseStreamEvent(rawEvent, request.onChunk, content, usage);
          if (eventState.done) {
            return {
              content: content.value,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              latencyMs: Date.now() - startedAt
            };
          }

          boundaryIndex = buffer.indexOf('\n\n');
        }
      }

      if (buffer.trim().length > 0) {
        parseStreamEvent(buffer, request.onChunk, content, usage);
      }

      return {
        content: content.value,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
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
