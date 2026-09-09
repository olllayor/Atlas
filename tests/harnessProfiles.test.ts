import assert from 'node:assert/strict';
import test from 'node:test';

import { LIGHTWEIGHT_PROMPT_HINT, resolveHarnessProfile, resolveHarnessPromptHint } from '../src/main/ai/core/harnessProfiles.js';

test('lightweight models get a tighter step budget', () => {
  assert.equal(resolveHarnessProfile('anthropic/claude-3-5-haiku').toolStepLimit, 32);
  assert.equal(resolveHarnessProfile('openai/gpt-4o-mini').toolStepLimit, 32);
  assert.equal(resolveHarnessProfile('mistral-small-latest').toolStepLimit, 32);
  assert.equal(resolveHarnessProfile('google/gemini-2.5-flash').toolStepLimit, 32);
});

test('heavy/reasoning models defer to the configured cap', () => {
  for (const id of ['anthropic/claude-opus-4-7', 'openai/o3-mini', 'deepseek-r1', 'gemini-3-pro']) {
    const profile = resolveHarnessProfile(id);
    assert.equal(profile.profile, 'heavy', id);
    assert.equal(profile.toolStepLimit, null, id);
  }
});

test('unknown models default to standard and are never throttled', () => {
  const profile = resolveHarnessProfile('some-new-model-xyz');
  assert.equal(profile.profile, 'standard');
  // `null` means "no opinion" — the configured cap stands. A stale pattern
  // table must not silently shrink the budget of a model it has not heard of.
  assert.equal(profile.toolStepLimit, null);
});

test('lightweight patterns match id segments, not raw substrings', () => {
  // Regression: `gemini` contains the substring `mini`, which classified every
  // Gemini model — including Pro — as a lightweight 32-step chat model.
  assert.equal(resolveHarnessProfile('gemini-2.0').profile, 'standard');
  assert.equal(resolveHarnessProfile('google/gemini-2.5-pro').profile, 'heavy');
});

test('reasoning marker wins over a lightweight marker in the same id', () => {
  assert.equal(resolveHarnessProfile('o3-mini').profile, 'heavy');
});

test('current frontier ids are not downgraded', () => {
  for (const id of ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1', 'gpt-5', 'grok-4']) {
    assert.equal(resolveHarnessProfile(id).toolStepLimit, null, id);
  }
});

test('lightweight tier carries a prompt hint, other tiers stay silent', () => {
  assert.equal(resolveHarnessProfile('openai/gpt-4o-mini').promptHint, LIGHTWEIGHT_PROMPT_HINT);
  assert.equal(resolveHarnessProfile('anthropic/claude-opus-4-7').promptHint, null);
  assert.equal(resolveHarnessProfile('some-new-model-xyz').promptHint, null);
});

test('resolveHarnessPromptHint answers without the full profile', () => {
  assert.equal(resolveHarnessPromptHint('openai/gpt-4o-mini'), LIGHTWEIGHT_PROMPT_HINT);
  assert.equal(resolveHarnessPromptHint('gpt-5'), null);
  assert.equal(resolveHarnessPromptHint(undefined), null);
});
