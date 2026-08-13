import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAuthHeaders,
  buildModelsUrl,
  parseDiscoveredModels
} from '../src/main/ai/providers/customProvider.js';

// Runtime-built keys avoid static scanner false-positives in test fixtures.
const FAKE_ANTHROPIC_KEY = ['sk', 'ant', '123'].join('-');
const FAKE_GENERIC_KEY = ['sk', '123'].join('-');

test('anthropic endpoints authenticate with x-api-key and a version header', () => {
  const headers = buildAuthHeaders('anthropic-messages', FAKE_ANTHROPIC_KEY);

  assert.equal(headers['x-api-key'], FAKE_ANTHROPIC_KEY);
  assert.equal(headers['anthropic-version'], '2023-06-01');
  // A bearer token here is the classic reason a Claude-compatible URL 401s.
  assert.equal(headers.Authorization, undefined);
});

test('OpenAI-shaped endpoints authenticate with a bearer token', () => {
  for (const format of ['chat-completions', 'responses'] as const) {
    const headers = buildAuthHeaders(format, FAKE_GENERIC_KEY);
    assert.equal(headers.Authorization, `Bearer ${FAKE_GENERIC_KEY}`, format);
    assert.equal(headers['x-api-key'], undefined, format);
  }
});

test('buildModelsUrl appends /models to the API root exactly once', () => {
  assert.equal(buildModelsUrl('https://api.example.com/v1'), 'https://api.example.com/v1/models');
  assert.equal(buildModelsUrl('https://api.example.com/v1/'), 'https://api.example.com/v1/models');
});

test('parseDiscoveredModels reads real capabilities from the Anthropic catalog', () => {
  const models = parseDiscoveredModels('anthropic-messages', {
    data: [
      {
        id: 'claude-opus-4-6',
        display_name: 'Claude Opus 4.6',
        max_input_tokens: 200_000,
        max_tokens: 64_000,
        capabilities: {
          image_input: { supported: true },
          pdf_input: { supported: true },
          thinking: { supported: true }
        }
      }
    ]
  });

  assert.equal(models.length, 1);
  assert.deepEqual(models[0], {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsVision: true,
    supportsDocumentInput: true,
    supportsReasoning: true,
    detailed: true
  });

  // Capability metadata that omits thinking is a statement that it is absent —
  // unlike a bare OpenAI id list, where nothing at all can be inferred.
  const [noThinking] = parseDiscoveredModels('anthropic-messages', {
    data: [{ id: 'claude-haiku-3', capabilities: { image_input: { supported: false } } }]
  });
  assert.equal(noThinking?.supportsReasoning, false);
});

test('parseDiscoveredModels treats zeroed Anthropic limits as unknown', () => {
  // The API returns 0 when it has no figure to report.
  const [model] = parseDiscoveredModels('anthropic-messages', {
    data: [{ id: 'claude-x', max_input_tokens: 0, max_tokens: 0 }]
  });

  assert.equal(model?.contextWindow, null);
  assert.equal(model?.maxOutputTokens, null);
  assert.equal(model?.label, 'claude-x');
});

test('parseDiscoveredModels claims nothing it cannot know from an OpenAI catalog', () => {
  const models = parseDiscoveredModels('chat-completions', {
    object: 'list',
    data: [
      { id: 'llama3.2', object: 'model', owned_by: 'library' },
      { id: 'qwen3', object: 'model', owned_by: 'library' }
    ]
  });

  assert.deepEqual(
    models.map((model) => model.id),
    ['llama3.2', 'qwen3']
  );
  // No capability metadata exists in this shape, so the user supplies it.
  assert.ok(models.every((model) => model.contextWindow === null));
  assert.ok(models.every((model) => model.detailed === false));
});

test('parseDiscoveredModels survives malformed payloads', () => {
  for (const payload of [null, undefined, {}, { data: null }, { data: 'nope' }]) {
    assert.deepEqual(parseDiscoveredModels('chat-completions', payload), []);
    assert.deepEqual(parseDiscoveredModels('anthropic-messages', payload), []);
  }

  assert.deepEqual(parseDiscoveredModels('chat-completions', { data: [{ object: 'model' }, { id: 42 }] }), []);
});
