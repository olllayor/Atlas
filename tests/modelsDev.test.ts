import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ModelsDevCatalog,
  deriveReasoningEfforts,
  inferApiFormat,
  normalizeModelKey,
  toModelFacts
} from '../src/main/ai/catalog/modelsDev.js';

const claude = {
  id: 'claude-opus-4-6',
  name: 'Claude Opus 4.6',
  description: '',
  attachment: true,
  reasoning: true,
  tool_call: true,
  temperature: false,
  release_date: '2026-02-04',
  last_updated: '2026-02-04',
  modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
  open_weights: false,
  limit: { context: 200_000, output: 64_000 },
  cost: { input: 5, output: 25 },
  reasoning_options: [{ type: 'budget_tokens', min: 1024, max: 32_000 }]
} as never;

const freeModel = {
  id: 'free-model',
  name: 'Free Model',
  description: '',
  attachment: false,
  reasoning: false,
  tool_call: false,
  release_date: '2026-01-01',
  last_updated: '2026-01-01',
  modalities: { input: ['text'], output: ['text'] },
  open_weights: true,
  limit: { context: 32_000, output: 8_000 },
  cost: { input: 0, output: 0 }
} as never;

function catalogWith(providers: Record<string, unknown>) {
  return new ModelsDevCatalog({
    providers: async () => providers as never,
    models: async () => ({}) as never,
    catalog: async () => ({}) as never
  });
}

test('toModelFacts maps models.dev capabilities onto the fields the app stores', () => {
  const facts = toModelFacts(claude);

  assert.equal(facts.label, 'Claude Opus 4.6');
  assert.equal(facts.contextWindow, 200_000);
  assert.equal(facts.maxOutputTokens, 64_000);
  assert.equal(facts.supportsVision, true);
  assert.equal(facts.supportsDocumentInput, true);
  assert.equal(facts.supportsReasoning, true);
  assert.equal(facts.supportsTools, true);
  // Recorded explicitly, and sending temperature anyway is a hard error.
  assert.equal(facts.supportsTemperature, false);
  assert.equal(facts.isFree, false);
  // A token budget maps onto the app's ladder.
  assert.deepEqual(facts.reasoningEfforts, ['off', 'low', 'medium', 'high', 'max']);
});

test('toModelFacts only calls a model free when the price is genuinely zero', () => {
  assert.equal(toModelFacts(freeModel).isFree, true);

  // Absent pricing means subscription-only, which is not the same as free.
  const noPricing = toModelFacts({ ...(freeModel as object), cost: undefined } as never);
  assert.equal(noPricing.isFree, false);
});

test('normalizeModelKey strips gateway vendor prefixes and tier suffixes', () => {
  assert.equal(normalizeModelKey('z-ai/glm-5'), 'glm-5');
  assert.equal(normalizeModelKey('deepseek/deepseek-v4:free'), 'deepseek-v4');
  assert.equal(normalizeModelKey('anthropic/claude-opus-4-6:beta'), 'claude-opus-4-6');
  assert.equal(normalizeModelKey('  GPT-5  '), 'gpt-5');
});

test('inferApiFormat reads the wire format from the provider package', () => {
  assert.equal(inferApiFormat({ npm: '@ai-sdk/anthropic', models: {} }), 'anthropic-messages');
  assert.equal(inferApiFormat({ npm: '@ai-sdk/openai-compatible', models: {} }), 'chat-completions');
  // Unknown packages default to the near-universal OpenAI shape.
  assert.equal(inferApiFormat({ npm: '@some/unknown', models: {} }), 'chat-completions');
});

test('inferApiFormat picks Responses only when every model pins that shape', () => {
  const responsesOnly = {
    npm: '@ai-sdk/openai',
    models: { a: { provider: { shape: 'responses' } }, b: { provider: { shape: 'responses' } } }
  } as never;
  assert.equal(inferApiFormat(responsesOnly), 'responses');

  const mixed = {
    npm: '@ai-sdk/openai',
    models: { a: { provider: { shape: 'responses' } }, b: {} }
  } as never;
  assert.equal(inferApiFormat(mixed), 'chat-completions');
});

test('lookup finds a model through a gateway-prefixed id', async () => {
  const catalog = catalogWith({
    anthropic: { id: 'anthropic', name: 'Anthropic', npm: '@ai-sdk/anthropic', doc: '', env: [], models: { 'claude-opus-4-6': claude } }
  });

  const viaGateway = await catalog.lookup('anthropic/claude-opus-4-6:beta');
  assert.equal(viaGateway?.contextWindow, 200_000);

  assert.equal(await catalog.lookup('not-a-real-model'), null);
});

test('enrich fills in what an OpenAI-compatible model list cannot report', async () => {
  const catalog = catalogWith({
    openrouter: {
      id: 'openrouter',
      name: 'OpenRouter',
      npm: '@openrouter/ai-sdk-provider',
      doc: '',
      env: [],
      models: { 'claude-opus-4-6': claude }
    }
  });

  const [enriched] = await catalog.enrich([
    {
      id: 'anthropic/claude-opus-4-6',
      label: 'anthropic/claude-opus-4-6',
      contextWindow: null,
      maxOutputTokens: null,
      // What OpenAI-compatible discovery now produces: unknown, not "cannot".
      supportsVision: null,
      supportsDocumentInput: null,
      detailed: false
    }
  ]);

  assert.equal(enriched?.contextWindow, 200_000);
  assert.equal(enriched?.maxOutputTokens, 64_000);
  assert.equal(enriched?.supportsVision, true);
  assert.equal(enriched?.supportsReasoning, true);
  assert.deepEqual(enriched?.reasoningEfforts, ['off', 'low', 'medium', 'high', 'max']);
  assert.equal(enriched?.label, 'Claude Opus 4.6');
  assert.equal(enriched?.detailed, true);
});

test('enrich does not overrule a modality the endpoint stated outright', async () => {
  const catalog = catalogWith({
    openrouter: {
      id: 'openrouter',
      name: 'OpenRouter',
      npm: '@openrouter/ai-sdk-provider',
      doc: '',
      env: [],
      models: { 'claude-opus-4-6': claude }
    }
  });

  const [enriched] = await catalog.enrich([
    {
      id: 'anthropic/claude-opus-4-6',
      label: 'anthropic/claude-opus-4-6',
      contextWindow: null,
      maxOutputTokens: null,
      // An Anthropic-format list reports capabilities for the deployment in
      // front of us; the catalog describes the weights in general.
      supportsVision: false,
      supportsDocumentInput: false,
      detailed: false
    }
  ]);

  assert.equal(enriched?.supportsVision, false);
  assert.equal(enriched?.supportsDocumentInput, false);
  // Everything the endpoint said nothing about is still filled in.
  assert.equal(enriched?.contextWindow, 200_000);
});

test('enrich leaves a model the endpoint already described alone', async () => {
  const catalog = catalogWith({
    anthropic: { id: 'anthropic', name: 'Anthropic', npm: '@ai-sdk/anthropic', doc: '', env: [], models: { 'claude-opus-4-6': claude } }
  });

  const original = {
    id: 'claude-opus-4-6',
    label: 'Custom label',
    contextWindow: 111,
    maxOutputTokens: 222,
    supportsVision: false,
    supportsDocumentInput: false,
    detailed: true
  };

  assert.deepEqual((await catalog.enrich([original]))[0], original);
});

test('enrich degrades to the input when models.dev is unreachable', async () => {
  const catalog = new ModelsDevCatalog({
    providers: async () => {
      throw new Error('offline');
    },
    models: async () => ({}) as never,
    catalog: async () => ({}) as never
  });

  const input = [
    {
      id: 'anything',
      label: 'anything',
      contextWindow: null,
      maxOutputTokens: null,
      supportsVision: false,
      supportsDocumentInput: false,
      detailed: false
    }
  ];

  // Metadata is an enrichment, not a dependency.
  assert.deepEqual(await catalog.enrich(input), input);
});

test('presets expose only providers with a usable model list', async () => {
  const catalog = catalogWith({
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic',
      npm: '@ai-sdk/anthropic',
      api: 'https://api.anthropic.com/v1',
      doc: 'https://docs',
      env: [],
      models: { 'claude-opus-4-6': claude }
    },
    empty: { id: 'empty', name: 'Empty', npm: 'x', doc: '', env: [], models: {} }
  });

  const presets = await catalog.listProviderPresets();

  assert.equal(presets.length, 1);
  assert.equal(presets[0]?.name, 'Anthropic');
  assert.equal(presets[0]?.baseUrl, 'https://api.anthropic.com/v1');
  assert.equal(presets[0]?.apiFormat, 'anthropic-messages');
});

test('the catalog is fetched once and reused', async () => {
  let calls = 0;
  const catalog = new ModelsDevCatalog({
    providers: async () => {
      calls += 1;
      return {} as never;
    },
    models: async () => ({}) as never,
    catalog: async () => ({}) as never
  });

  await Promise.all([catalog.load(), catalog.load()]);
  await catalog.load();

  assert.equal(calls, 1);
});

test('deriveReasoningEfforts flattens each models.dev control surface', () => {
  const base = { ...(freeModel as object), reasoning: true } as Record<string, unknown>;

  // Toggle + graded levels (deepseek-v4-flash shape): off joins the levels.
  assert.deepEqual(
    deriveReasoningEfforts({
      ...base,
      reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['high', 'max'] }]
    } as never),
    ['off', 'high', 'max']
  );

  // Toggle only (glm shape): binary switch, nothing graded to offer.
  assert.deepEqual(deriveReasoningEfforts({ ...base, reasoning_options: [{ type: 'toggle' }] } as never), [
    'off',
    'on'
  ]);

  // `none`/null spell an explicit opt-out; `default` is not a pickable level.
  assert.deepEqual(
    deriveReasoningEfforts({
      ...base,
      reasoning_options: [{ type: 'effort', values: ['none', null, 'default', 'low', 'xhigh'] }]
    } as never),
    ['off', 'low', 'xhigh']
  );

  // Token budget: the app's ladder maps onto it.
  assert.deepEqual(
    deriveReasoningEfforts({ ...base, reasoning_options: [{ type: 'budget_tokens', min: 1024 }] } as never),
    ['off', 'low', 'medium', 'high', 'max']
  );

  // An empty options array is an uncatalogued entry, not "no control": the
  // same model carries real levels under other providers.
  assert.equal(deriveReasoningEfforts({ ...base, reasoning_options: [] } as never), null);

  // Options that name no pickable level say nothing either.
  assert.equal(
    deriveReasoningEfforts({ ...base, reasoning_options: [{ type: 'effort', values: ['default'] }] } as never),
    null
  );

  // The database said nothing: unknown, so the caller falls back to defaults.
  assert.equal(deriveReasoningEfforts({ ...base, reasoning_options: undefined } as never), null);
  assert.equal(deriveReasoningEfforts(freeModel), null);
});

test('lookup borrows reasoning levels from a better-catalogued provider entry', async () => {
  const bare = {
    ...(claude as object),
    id: 'gpt-oss-120b',
    name: 'GPT OSS 120B',
    reasoning: true,
    reasoning_options: []
  };
  const rich = {
    ...(bare as object),
    id: 'openai/gpt-oss-120b',
    limit: { context: 111, output: 222 },
    reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }]
  };

  const catalog = catalogWith({
    // The hinted provider knows the model but not its levels.
    greenpt: { id: 'greenpt', name: 'GreenPT', npm: '', doc: '', env: [], models: { 'gpt-oss-120b': bare } },
    nvidia: { id: 'nvidia', name: 'NVIDIA', npm: '', doc: '', env: [], models: { 'openai/gpt-oss-120b': rich } }
  });

  const facts = await catalog.lookup('gpt-oss-120b', 'greenpt');
  assert.deepEqual(facts?.reasoningEfforts, ['low', 'medium', 'high']);
  // Limits still come from the hinted provider's own entry, not the donor's.
  assert.equal(facts?.contextWindow, 200_000);
});
