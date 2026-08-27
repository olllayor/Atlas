import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenCodeEventTranslator } from '../src/main/ai/providers/opencode/openCodeEvents.js';

const SESSION = 'ses_1';

type Recorded = { kind: string; payload: Record<string, unknown> };

function recorder() {
  const events: Recorded[] = [];
  const push = (kind: string) => (payload: unknown) =>
    events.push({ kind, payload: payload as Record<string, unknown> });

  return {
    events,
    callbacks: {
      onChunk: push('chunk'),
      onReasoningChunk: push('reasoning'),
      onToolInputStart: push('tool-start'),
      onToolInputDelta: push('tool-delta'),
      onToolInputAvailable: push('tool-input'),
      onToolOutputAvailable: push('tool-output'),
      onToolOutputError: push('tool-error'),
      onToolApprovalRequested: push('approval')
    }
  };
}

function nextEvent(type: string, properties: Record<string, unknown>) {
  return { id: `evt_${type}`, type, properties: { sessionID: SESSION, ...properties } };
}

test('session.next deltas stream text, reasoning and a full tool lifecycle', () => {
  const { events, callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  translator.handle(nextEvent('session.next.reasoning.delta', { reasoningID: 'r1', delta: 'thinking' }));
  translator.handle(nextEvent('session.next.text.delta', { textID: 't1', delta: 'Hello' }));
  translator.handle(nextEvent('session.next.text.delta', { textID: 't1', delta: ' world' }));
  translator.handle(nextEvent('session.next.tool.input.started', { callID: 'c1', name: 'bash' }));
  translator.handle(nextEvent('session.next.tool.input.delta', { callID: 'c1', delta: '{"cmd"' }));
  translator.handle(nextEvent('session.next.tool.called', { callID: 'c1', tool: 'bash', input: { cmd: 'ls' } }));
  translator.handle(
    nextEvent('session.next.tool.success', { callID: 'c1', content: [{ text: 'file.txt' }] })
  );
  translator.handle(nextEvent('session.next.text.ended', { textID: 't1', text: 'Hello world' }));
  translator.handle(nextEvent('session.idle', {}));

  assert.equal(translator.assistantText, 'Hello world');
  assert.equal(translator.assistantReasoning, 'thinking');
  assert.equal(translator.isIdle, true);
  assert.equal(translator.errorText, null);

  assert.deepEqual(
    events.map((event) => event.kind),
    ['reasoning', 'chunk', 'chunk', 'tool-start', 'tool-delta', 'tool-input', 'tool-output']
  );

  const output = events.find((event) => event.kind === 'tool-output')!;
  assert.equal(output.payload.output, 'file.txt');
  assert.equal(output.payload.toolName, 'bash');
  assert.deepEqual(output.payload.input, { cmd: 'ls' });
  // opencode ran the tool, so the transcript must not offer to run it again.
  assert.equal(output.payload.providerExecuted, true);
});

test('text.ended without deltas emits the whole message once', () => {
  const { events, callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  translator.handle(nextEvent('session.next.text.ended', { textID: 't1', text: 'Only answer' }));
  translator.handle(nextEvent('session.next.text.ended', { textID: 't1', text: 'Only answer' }));

  assert.equal(translator.assistantText, 'Only answer');
  assert.equal(events.filter((event) => event.kind === 'chunk').length, 1);
});

test('the first event family wins, so a duplicating server cannot double text', () => {
  const { callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  translator.handle(nextEvent('session.next.text.delta', { textID: 't1', delta: 'Hi' }));
  translator.handle(
    nextEvent('message.part.updated', { part: { id: 't1', type: 'text', text: 'Hi' } })
  );

  assert.equal(translator.assistantText, 'Hi');
});

test('legacy part snapshots stream the difference, not the whole part again', () => {
  const { events, callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  translator.handle(nextEvent('message.part.updated', { part: { id: 'p1', type: 'text', text: 'Hel' } }));
  translator.handle(nextEvent('message.part.updated', { part: { id: 'p1', type: 'text', text: 'Hello' } }));
  translator.handle(
    nextEvent('message.part.delta', { partID: 'p1', field: 'text', delta: '!' })
  );

  assert.equal(translator.assistantText, 'Hello!');
  assert.deepEqual(
    events.filter((event) => event.kind === 'chunk').map((event) => event.payload.delta),
    ['Hel', 'lo', '!']
  );
});

test('legacy tool parts translate pending → running → completed once', () => {
  const { events, callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  const toolPart = (state: Record<string, unknown>) =>
    nextEvent('message.part.updated', {
      part: { id: 'p2', type: 'tool', callID: 'c9', tool: 'edit', state }
    });

  translator.handle(toolPart({ status: 'pending', input: { path: 'a.ts' }, raw: '{}' }));
  translator.handle(toolPart({ status: 'running', input: { path: 'a.ts' }, title: 'Edit a.ts' }));
  translator.handle(
    toolPart({ status: 'completed', input: { path: 'a.ts' }, output: 'done', title: 'Edit a.ts' })
  );
  translator.handle(toolPart({ status: 'completed', input: { path: 'a.ts' }, output: 'done' }));

  assert.deepEqual(
    events.map((event) => event.kind),
    ['tool-start', 'tool-input', 'tool-output']
  );
  assert.equal(events[2]!.payload.output, 'done');
});

test('tool failures surface a sentence, never a raw object', () => {
  const { events, callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  translator.handle(nextEvent('session.next.tool.input.started', { callID: 'c1', name: 'bash' }));
  translator.handle(
    nextEvent('session.next.tool.failed', {
      callID: 'c1',
      error: { name: 'ToolError', data: { message: 'exit status 1' } }
    })
  );

  const failure = events.find((event) => event.kind === 'tool-error')!;
  assert.equal(failure.payload.errorText, 'exit status 1');
});

test('permission asks reach the approval surface once, with their resources', () => {
  const { events, callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  const ask = nextEvent('permission.asked', {
    id: 'perm_1',
    permission: 'edit',
    patterns: ['src/**'],
    tool: { messageID: 'm1', callID: 'c1' }
  });
  translator.handle(ask);
  translator.handle(ask);

  const approvals = events.filter((event) => event.kind === 'approval');
  assert.equal(approvals.length, 1);
  assert.deepEqual(approvals[0]!.payload, {
    approvalId: 'perm_1',
    toolCallId: 'c1',
    toolName: 'edit',
    reason: 'src/**'
  });
  assert.deepEqual(
    translator.takePendingPermissions().map((entry) => entry.approvalId),
    ['perm_1']
  );
  assert.deepEqual(translator.takePendingPermissions(), []);
});

test('another session\'s events are ignored', () => {
  const { events, callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  translator.handle({
    id: 'e',
    type: 'session.next.text.delta',
    properties: { sessionID: 'ses_other', textID: 't', delta: 'nope' }
  });

  assert.equal(translator.assistantText, '');
  assert.deepEqual(events, []);
});

test('session errors end the turn and mark aborts as aborts', () => {
  const { callbacks } = recorder();

  const failed = new OpenCodeEventTranslator(SESSION, callbacks);
  failed.handle(nextEvent('session.error', { error: { name: 'ProviderAuthError', data: { message: 'no key' } } }));
  assert.equal(failed.errorText, 'no key');
  assert.equal(failed.isIdle, true);
  assert.equal(failed.wasAborted, false);

  const aborted = new OpenCodeEventTranslator(SESSION, callbacks);
  aborted.handle(nextEvent('session.error', { error: { name: 'MessageAbortedError' } }));
  assert.equal(aborted.wasAborted, true);
});
