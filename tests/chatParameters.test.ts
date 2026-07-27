import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAnthropicThinkingOptions,
  buildCustomProviderReasoningOptions,
  buildGlmThinkingOptions,
  buildOpenAICompatibleReasoningOptions,
  buildOpenRouterReasoningOptions
} from '../src/main/ai/providers/reasoningOptions.js';
import { createBuiltInTools, describeToolPermissionsForPrompt } from '../src/main/ai/tools/builtInTools.js';
import {
  DEFAULT_REASONING_EFFORT,
  DEFAULT_TOOL_PERMISSION_MODE,
  isReasoningEffort,
  isToolPermissionMode
} from '../src/shared/chatParameters.js';

const modelsRepo = { list: () => [] } as never;

function toolNames(mode: Parameters<typeof createBuiltInTools>[2]) {
  return Object.keys(createBuiltInTools(modelsRepo, null, mode)).sort();
}

function needsApproval(mode: Parameters<typeof createBuiltInTools>[2], toolName: string) {
  const tools = createBuiltInTools(modelsRepo, null, mode) as Record<string, { needsApproval?: unknown }>;
  return tools[toolName]?.needsApproval;
}

test('read-only mode withholds the tools that reach outside the app', () => {
  const names = toolNames('read-only');

  // Withholding beats prompting: the model cannot call what it was never given.
  assert.equal(names.includes('bash'), false);
  assert.equal(names.includes('web_fetch'), false);
  assert.equal(names.includes('web_search'), false);

  // Local reads stay available.
  assert.equal(names.includes('read_file'), true);
  assert.equal(names.includes('grep_search'), true);
  assert.equal(names.includes('glob_search'), true);
});

test('ask mode offers every tool and keeps the risky ones gated', () => {
  const names = toolNames('ask');

  assert.equal(names.includes('bash'), true);
  assert.equal(names.includes('web_fetch'), true);
  assert.equal(needsApproval('ask', 'bash'), true);
  assert.equal(needsApproval('ask', 'web_fetch'), true);
});

test('full-access keeps every tool but stops pausing for approval', () => {
  const names = toolNames('full-access');

  assert.equal(names.includes('bash'), true);
  assert.equal(needsApproval('full-access', 'bash'), false);
  assert.equal(needsApproval('full-access', 'web_fetch'), false);
});

test('the default mode is the one that asks before running anything risky', () => {
  assert.equal(DEFAULT_TOOL_PERMISSION_MODE, 'ask');
  assert.equal(needsApproval(DEFAULT_TOOL_PERMISSION_MODE, 'bash'), true);
});

test('read-only still surfaces tools contributed by other subsystems', () => {
  const tools = createBuiltInTools(modelsRepo, { create_site: {} }, 'read-only');

  assert.equal('create_site' in tools, true);
});

test('the system prompt states what the active mode allows', () => {
  assert.match(describeToolPermissionsForPrompt('read-only'), /unavailable/i);
  assert.match(describeToolPermissionsForPrompt('full-access'), /without asking/i);
  assert.match(describeToolPermissionsForPrompt('ask'), /approve/i);
});

test('OpenRouter receives a graded effort and an explicit opt-out', () => {
  assert.deepEqual(buildOpenRouterReasoningOptions('high', true), { reasoning: { effort: 'high' } });
  // `max` is in OpenRouter's own supported_efforts list, so it passes through.
  assert.deepEqual(buildOpenRouterReasoningOptions('max', true), { reasoning: { effort: 'max' } });
  assert.deepEqual(buildOpenRouterReasoningOptions('off', true), {
    reasoning: { enabled: false, exclude: true }
  });
});

test('no reasoning options are sent to a model that has no thinking mode', () => {
  assert.equal(buildOpenRouterReasoningOptions('high', false), null);
  assert.equal(buildGlmThinkingOptions('high', false), null);
  assert.equal(buildOpenAICompatibleReasoningOptions('high', false), null);
  assert.equal(buildAnthropicThinkingOptions('high', false, 32_000), null);
});

test('GLM collapses graded effort onto its binary thinking switch', () => {
  assert.deepEqual(buildGlmThinkingOptions('low', true), { thinking: { type: 'enabled' } });
  assert.deepEqual(buildGlmThinkingOptions('max', true), { thinking: { type: 'enabled' } });
  assert.deepEqual(buildGlmThinkingOptions('off', true), { thinking: { type: 'disabled' } });
  // Unset means "leave the provider default alone", which for GLM is disabled.
  assert.deepEqual(buildGlmThinkingOptions(undefined, true), { thinking: { type: 'disabled' } });
});

test('Anthropic budgets thinking in tokens and never eats the whole completion', () => {
  assert.deepEqual(buildAnthropicThinkingOptions('low', true, 32_000), {
    thinking: { type: 'enabled', budgetTokens: 2_048 }
  });

  // Half the completion allowance is the ceiling, so the answer still fits.
  assert.deepEqual(buildAnthropicThinkingOptions('max', true, 8_192), {
    thinking: { type: 'enabled', budgetTokens: 4_096 }
  });

  // Too little room to think usefully: send nothing rather than a broken budget.
  assert.equal(buildAnthropicThinkingOptions('max', true, 1_024), null);
  assert.equal(buildAnthropicThinkingOptions('off', true, 32_000), null);
});

test('OpenAI-compatible endpoints get reasoning_effort, with max degraded to high', () => {
  assert.deepEqual(buildOpenAICompatibleReasoningOptions('medium', true), { reasoningEffort: 'medium' });
  // `max` is not part of the OpenAI vocabulary.
  assert.deepEqual(buildOpenAICompatibleReasoningOptions('max', true), { reasoningEffort: 'high' });
  assert.deepEqual(buildOpenAICompatibleReasoningOptions('off', true), { reasoningEffort: 'none' });
});

test('custom providers route effort to the namespace their format expects', () => {
  const anthropic = buildCustomProviderReasoningOptions({
    apiFormat: 'anthropic-messages',
    effort: 'high',
    supportsReasoning: true,
    maxOutputTokens: 32_000
  });
  assert.equal(anthropic?.namespace, 'anthropic');
  assert.deepEqual(anthropic?.options, { thinking: { type: 'enabled', budgetTokens: 8_192 } });

  assert.equal(
    buildCustomProviderReasoningOptions({
      apiFormat: 'responses',
      effort: 'high',
      supportsReasoning: true,
      maxOutputTokens: 32_000
    })?.namespace,
    'openai'
  );

  assert.equal(
    buildCustomProviderReasoningOptions({
      apiFormat: 'chat-completions',
      effort: 'high',
      supportsReasoning: true,
      maxOutputTokens: 32_000
    })?.namespace,
    'custom'
  );
});

test('parameter guards reject values that did not come from the UI', () => {
  assert.equal(isReasoningEffort(DEFAULT_REASONING_EFFORT), true);
  assert.equal(isReasoningEffort('ludicrous'), false);
  assert.equal(isToolPermissionMode(DEFAULT_TOOL_PERMISSION_MODE), true);
  assert.equal(isToolPermissionMode('root'), false);
});
