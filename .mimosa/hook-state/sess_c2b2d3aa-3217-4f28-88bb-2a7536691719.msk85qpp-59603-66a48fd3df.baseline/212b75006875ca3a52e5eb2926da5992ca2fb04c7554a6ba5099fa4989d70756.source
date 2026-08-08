import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolExecutionTracker } from '../src/main/ai/tools/ToolExecutionTracker.js';
import type { StreamEvent } from '../src/shared/contracts.js';

test('ToolExecutionTracker maps stream events to persisted lifecycle states', () => {
  const saved: Array<Record<string, unknown>> = [];
  const markedErrors: Array<{ requestId: string; errorCode: string; errorMessage: string }> = [];
  const tracker = new ToolExecutionTracker(
    {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      requestId: 'request-1',
    },
    {
      save: (input: Record<string, unknown>) => saved.push(input),
      markRequestError: (requestId: string, errorCode: string, errorMessage: string) =>
        markedErrors.push({ requestId, errorCode, errorMessage }),
    } as never
  );

  const events: StreamEvent[] = [
    {
      type: 'tool-input-start',
      requestId: 'request-1',
      toolCallId: 'tool-1',
      toolName: 'web_search',
    },
    {
      type: 'tool-input-available',
      requestId: 'request-1',
      toolCallId: 'tool-1',
      toolName: 'web_search',
      input: { query: 'atlas' },
    },
    {
      type: 'tool-approval-requested',
      requestId: 'request-1',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
      toolName: 'web_search',
      reason: 'Needs network access',
    },
    {
      type: 'tool-approval-responded',
      requestId: 'request-1',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
      approved: true,
    },
    {
      type: 'tool-output-available',
      requestId: 'request-1',
      toolCallId: 'tool-1',
      toolName: 'web_search',
      output: 'Found 3 results',
      preliminary: true,
    },
    {
      type: 'tool-output-available',
      requestId: 'request-1',
      toolCallId: 'tool-1',
      toolName: 'web_search',
      output: 'Found 9 results',
      preliminary: false,
    },
  ];

  for (const event of events) {
    tracker.handleEvent(event);
  }

  assert.deepEqual(
    saved.map((entry) => entry.state),
    ['queued', 'running', 'approval_requested', 'approved', 'partial', 'completed']
  );

  const completed = saved[saved.length - 1];
  assert.equal(completed?.finalOutputPreview, 'Found 9 results');
  assert.equal(typeof completed?.finishedAt, 'string');
  assert.equal(markedErrors.length, 0);
});

test('ToolExecutionTracker persists denied/error tool runs with user-readable summaries', () => {
  const saved: Array<Record<string, unknown>> = [];
  const tracker = new ToolExecutionTracker(
    {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      requestId: 'request-2',
    },
    {
      save: (input: Record<string, unknown>) => saved.push(input),
      markRequestError: () => undefined,
    } as never
  );

  tracker.handleEvent({
    type: 'tool-output-denied',
    requestId: 'request-2',
    toolCallId: 'tool-denied',
    toolName: 'search',
  });
  tracker.handleEvent({
    type: 'tool-output-error',
    requestId: 'request-2',
    toolCallId: 'tool-error',
    toolName: 'read_file',
    errorText: 'ENOENT: file not found',
  });

  const denied = saved[0];
  assert.equal(denied?.state, 'denied');
  assert.equal(denied?.finalOutputPreview, 'Search was not run because permission was denied.');

  const errored = saved[1];
  assert.equal(errored?.state, 'error');
  assert.equal(errored?.errorCode, 'not_found');
  assert.equal(errored?.errorMessage, "Couldn't find the requested file or resource.");
});
