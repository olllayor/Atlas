import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CustomProviderValidationError,
  buildCustomProviderId,
  formatContextWindow,
  isCustomProviderId,
  normalizeBaseUrl,
  normalizeModelInputs,
  normalizeProviderName
} from '../src/shared/customProviders.js';

test('normalizeBaseUrl keeps the API root and drops a pasted completion path', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1'), 'https://api.example.com/v1');
  assert.equal(normalizeBaseUrl('  https://api.example.com/v1/  '), 'https://api.example.com/v1');
  // The single most common configuration mistake.
  assert.equal(normalizeBaseUrl('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1');
  assert.equal(normalizeBaseUrl('https://api.example.com/v1/responses'), 'https://api.example.com/v1');
  assert.equal(normalizeBaseUrl('https://api.anthropic.com/v1/messages'), 'https://api.anthropic.com/v1');
});

test('normalizeBaseUrl strips query strings and fragments', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1?key=abc#frag'), 'https://api.example.com/v1');
});

test('normalizeBaseUrl allows plain http only for a local runtime', () => {
  assert.equal(normalizeBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1');

  assert.throws(() => normalizeBaseUrl('http://api.example.com/v1'), CustomProviderValidationError);
});

test('normalizeBaseUrl rejects junk', () => {
  assert.throws(() => normalizeBaseUrl(''), CustomProviderValidationError);
  assert.throws(() => normalizeBaseUrl('api.example.com/v1'), CustomProviderValidationError);
  assert.throws(() => normalizeBaseUrl('ftp://api.example.com/v1'), CustomProviderValidationError);
});

test('normalizeProviderName collapses whitespace and rejects empties', () => {
  assert.equal(normalizeProviderName('  My   Gateway '), 'My Gateway');
  assert.throws(() => normalizeProviderName('   '), CustomProviderValidationError);
  assert.throws(() => normalizeProviderName('x'.repeat(61)), CustomProviderValidationError);
});

test('normalizeModelInputs defaults capabilities and drops duplicates', () => {
  const models = normalizeModelInputs([
    { id: ' gpt-oss ' },
    { id: 'gpt-oss' },
    { id: 'vision-model', supportsVision: true, contextWindow: 32_000 }
  ]);

  assert.deepEqual(
    models.map((model) => model.id),
    ['gpt-oss', 'vision-model']
  );
  // Tools default on: most endpoints support them and the UI can toggle it off.
  // Unknown, not claimed: a tool refusal is now recorded the first time it happens.
  assert.equal(models[0]?.supportsTools, null);
  assert.equal(models[0]?.supportsTemperature, true);
  assert.equal(models[0]?.label, 'gpt-oss');
  assert.equal(models[0]?.contextWindow, null);
  assert.equal(models[1]?.supportsVision, true);
  assert.equal(models[1]?.contextWindow, 32_000);
});

test('normalizeModelInputs rejects an empty model id', () => {
  assert.throws(() => normalizeModelInputs([{ id: '   ' }]), CustomProviderValidationError);
});

test('normalizeModelInputs treats non-positive limits as unknown', () => {
  const [model] = normalizeModelInputs([{ id: 'm', contextWindow: 0, maxOutputTokens: -5 }]);

  assert.equal(model?.contextWindow, null);
  assert.equal(model?.maxOutputTokens, null);
});

test('custom provider ids are recognisable and distinct from built-ins', () => {
  const id = buildCustomProviderId('abc');

  assert.equal(id, 'custom:abc');
  assert.equal(isCustomProviderId(id), true);
  assert.equal(isCustomProviderId('openrouter'), false);
  assert.equal(isCustomProviderId('glm'), false);
});

test('formatContextWindow renders the badge shown next to each model', () => {
  assert.equal(formatContextWindow(16_384), '16.4K');
  assert.equal(formatContextWindow(200_000), '200K');
  assert.equal(formatContextWindow(1_000_000), '1M');
  assert.equal(formatContextWindow(128), '128');
  assert.equal(formatContextWindow(null), null);
  assert.equal(formatContextWindow(0), null);
});
