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
      onToolApprovalRequested: push('approval'),
      onToolApprovalResolved: push('approval-resolved'),
      onQuestionRequested: push('question')
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

test('the user\'s own message is never replayed as the assistant answer', () => {
  const { events, callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  // Live ordering: opencode announces the user message before its parts.
  translator.handle(nextEvent('message.updated', { info: { id: 'msg_user', role: 'user' } }));
  translator.handle(
    nextEvent('message.part.updated', {
      part: { id: 'p_user', type: 'text', messageID: 'msg_user', text: 'Reply with exactly: pong' }
    })
  );
  translator.handle(
    nextEvent('message.part.updated', {
      part: { id: 'p_assistant', type: 'text', messageID: 'msg_assistant', text: 'pong' }
    })
  );

  assert.equal(translator.assistantText, 'pong');
  assert.deepEqual(
    events.filter((event) => event.kind === 'chunk').map((event) => event.payload.delta),
    ['pong']
  );
});

test('reasoning deltas follow the part kind, not the field name', () => {
  const { events, callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  // Live shape: a reasoning part's deltas also arrive with field "text".
  translator.handle(
    nextEvent('message.part.updated', { part: { id: 'p_think', type: 'reasoning', text: '' } })
  );
  translator.handle(nextEvent('message.part.delta', { partID: 'p_think', field: 'text', delta: 'hmm' }));
  translator.handle(
    nextEvent('message.part.updated', { part: { id: 'p_text', type: 'text', text: '' } })
  );
  translator.handle(nextEvent('message.part.delta', { partID: 'p_text', field: 'text', delta: 'pong' }));

  assert.equal(translator.assistantReasoning, 'hmm');
  assert.equal(translator.assistantText, 'pong');
  assert.deepEqual(
    events.map((event) => `${event.kind}:${event.payload.delta}`),
    ['reasoning:hmm', 'chunk:pong']
  );
});

test('synthetic parts opencode injects are not part of the answer', () => {
  const { callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  translator.handle(
    nextEvent('message.part.updated', {
      part: { id: 'p1', type: 'text', text: 'injected context', synthetic: true }
    })
  );

  assert.equal(translator.assistantText, '');
});

test('a delta belonging to the user\'s message is dropped like its snapshot', () => {
  const { events, callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  translator.handle(nextEvent('message.updated', { info: { id: 'msg_user', role: 'user' } }));
  translator.handle(
    nextEvent('message.part.delta', {
      partID: 'p_user',
      messageID: 'msg_user',
      field: 'text',
      delta: 'Reply with exactly: pong'
    })
  );
  translator.handle(
    nextEvent('message.part.delta', {
      partID: 'p_assistant',
      messageID: 'msg_assistant',
      field: 'text',
      delta: 'pong'
    })
  );

  assert.equal(translator.assistantText, 'pong');
  assert.deepEqual(
    events.map((event) => event.payload.delta),
    ['pong']
  );
});

test('question.asked normalizes questions, surfaces approvals, and tracks pending', () => {
  const { events, callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  const ask = nextEvent('question.asked', {
    id: 'q_1',
    sessionID: SESSION,
    questions: [
      {
        header: 'Database Migration',
        question: 'Run migration now?',
        options: [
          { label: 'Yes', description: 'Run immediately' },
          { label: 'No', description: 'Skip migration' }
        ],
        multiple: false
      }
    ],
    tool: { callID: 'c1', messageID: 'm1' }
  });

  translator.handle(ask);
  // Duplicate delivery must be ignored
  translator.handle(ask);

  const questions = events.filter((e) => e.kind === 'question');
  assert.equal(questions.length, 1);
  assert.equal(questions[0]!.payload.approvalId, 'q_1');
  assert.equal(questions[0]!.payload.header, 'Database Migration');

  const approvals = events.filter((e) => e.kind === 'approval');
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0]!.payload.approvalId, 'q_1');
  assert.equal(approvals[0]!.payload.toolName, 'question');
  assert.equal(
    approvals[0]!.payload.reason,
    '[Database Migration] Run migration now? (Yes / No)'
  );

  assert.equal(translator.hasPending('q_1'), true);
  const pending = translator.takePendingQuestions();
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.id, 'q_1');
  assert.equal(pending[0]!.questions[0]!.id, 'question-0-database-migration');
});

test('question.replied and question.rejected clean up pending questions and emit approval-resolved', () => {
  const { events, callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  translator.handle(
    nextEvent('question.asked', {
      id: 'q_1',
      questions: [{ header: 'Continue', question: 'Proceed?', options: [] }]
    })
  );
  assert.equal(translator.hasPending('q_1'), true);

  translator.handle(nextEvent('question.replied', { requestID: 'q_1' }));
  assert.equal(translator.hasPending('q_1'), false);
  const resolved = events.filter((e) => e.kind === 'approval-resolved');
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]!.payload.approvalId, 'q_1');

  translator.handle(
    nextEvent('question.asked', {
      id: 'q_2',
      questions: [{ header: 'Skip', question: 'Skip step?', options: [] }]
    })
  );
  assert.equal(translator.hasPending('q_2'), true);

  translator.handle(nextEvent('question.rejected', { requestID: 'q_2' }));
  assert.equal(translator.hasPending('q_2'), false);
  const resolved2 = events.filter((e) => e.kind === 'approval-resolved');
  assert.equal(resolved2.length, 2);
  assert.equal(resolved2[1]!.payload.approvalId, 'q_2');
});

test('permission.replied cleans up pending permissions and emits approval-resolved', () => {
  const { events, callbacks } = recorder();
  const translator = new OpenCodeEventTranslator(SESSION, callbacks);

  translator.handle(
    nextEvent('permission.asked', {
      id: 'p_1',
      permission: 'bash',
      patterns: ['rm -rf' ]
    })
  );
  assert.equal(translator.hasPending('p_1'), true);

  translator.handle(nextEvent('permission.replied', { requestID: 'p_1' }));
  assert.equal(translator.hasPending('p_1'), false);
  const resolved = events.filter((e) => e.kind === 'approval-resolved');
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]!.payload.approvalId, 'p_1');
});
