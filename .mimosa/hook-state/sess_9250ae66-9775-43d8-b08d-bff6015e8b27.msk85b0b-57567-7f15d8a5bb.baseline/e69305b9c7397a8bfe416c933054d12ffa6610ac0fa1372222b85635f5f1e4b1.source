import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectVisualFollowUp,
  detectVisualOptOut,
  detectVisualRequest,
  resolveVisualGate,
} from '../src/shared/visualIntent.js';

test('a request for something drawn opens the gate', () => {
  const asks = [
    'draw me a diagram of the auth flow',
    'can you visualize the request lifecycle?',
    'show me a chart of monthly revenue',
    'explain this visually',
    'give me a flowchart for the retry logic',
    'map this out for me',
    'compare them in a bar chart',
    'plot the latency over time',
    'give me a timeline of the release',
    'нарисуй схему архитектуры',
    'arxitektura sxemasini chizib ber',
  ];

  for (const ask of asks) {
    assert.equal(detectVisualRequest(ask), true, ask);
  }
});

test('ordinary questions leave the gate shut', () => {
  const asks = [
    'why is my build failing?',
    'refactor this function to use async/await',
    'what is the difference between a mutex and a semaphore?',
    'explain graph theory to me',
    'add a GraphQL endpoint for users',
    'what is the plot of Dune?',
    'draw a conclusion from these numbers',
    'open Visual Studio Code and check the settings',
    'summarize the paragraph above',
    'what is our timeline?',
  ];

  for (const ask of asks) {
    assert.equal(detectVisualRequest(ask), false, ask);
  }
});

test('pasted markup is context, not a request to draw', () => {
  assert.equal(detectVisualRequest('what does this do?\n```html\n<svg><circle r="4"/></svg>\n```'), false);
  assert.equal(detectVisualRequest('is `<div style="display:flex">` right here?'), false);
});

test('an explicit opt-out beats every other signal', () => {
  assert.equal(detectVisualOptOut('explain the architecture, no diagrams please'), true);
  assert.equal(detectVisualRequest('explain the architecture, no diagrams please'), false);
  assert.equal(
    resolveVisualGate({ mode: 'always', userText: 'walk me through it, text only' }).enabled,
    false
  );
});

test('follow-ups only count when a visual is already on screen', () => {
  assert.equal(detectVisualFollowUp('make it wider'), true);
  assert.equal(detectVisualFollowUp('add a node for the cache'), true);

  assert.equal(
    resolveVisualGate({ mode: 'auto', userText: 'make it wider', hadRecentVisual: false }).enabled,
    false
  );
  assert.equal(
    resolveVisualGate({ mode: 'auto', userText: 'make it wider', hadRecentVisual: true }).enabled,
    true
  );
});

test('a long message is a new question, not a refinement', () => {
  const long = `make it clearer ${'and walk through every branch of the parser '.repeat(8)}`;
  assert.equal(detectVisualFollowUp(long), false);
});

test('the mode is the outer switch', () => {
  assert.deepEqual(resolveVisualGate({ mode: 'off', userText: 'draw me a diagram' }), {
    enabled: false,
    reason: 'mode-off',
  });
  assert.deepEqual(resolveVisualGate({ mode: 'always', userText: 'hello' }), {
    enabled: true,
    reason: 'mode-always',
  });
  assert.deepEqual(resolveVisualGate({ mode: 'auto', userText: 'hello' }), {
    enabled: false,
    reason: 'not-requested',
  });
  assert.deepEqual(resolveVisualGate({ mode: 'auto', userText: 'draw me a diagram' }), {
    enabled: true,
    reason: 'requested',
  });
});
