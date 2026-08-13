import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolApprovalController } from '../src/main/ai/core/ToolApprovalController.js';

/**
 * R4 — session "always allow" grants: conversation-scoped, ephemeral, and only
 * ever written by an explicit `accept_for_session` decision.
 */

const APPROVAL = { approvalId: 'a1', toolCallId: 't1', conversationId: 'conv-A', sessionScopeKey: 'bash: echo hi' } as const;

test('accept_for_session records a grant only for the conversation that granted it', () => {
  const ctrl = new ToolApprovalController();
  const rid = 'r1';

  ctrl.setPendingApprovals(rid, [
    { ...APPROVAL, approvalId: 'a1', conversationId: 'conv-A' },
    { ...APPROVAL, approvalId: 'a2', conversationId: 'conv-B' },
  ]);

  const result = ctrl.respond(rid, { approvalId: 'a1', decision: 'accept_for_session' });

  assert.equal(result?.conversationId, 'conv-A');
  assert.ok(ctrl.hasConversationScopeGrant('conv-A', 'bash: echo hi'), 'grant recorded for the granting conversation');
  assert.equal(
    ctrl.hasConversationScopeGrant('conv-B', 'bash: echo hi'),
    false,
    'the same scope key must NOT leak to another conversation'
  );
});

test('a grant for one scope key does not cover a different key', () => {
  const ctrl = new ToolApprovalController();
  const rid = 'r2';

  ctrl.setPendingApprovals(rid, [{ ...APPROVAL, approvalId: 'a1', sessionScopeKey: 'web_search' }]);
  ctrl.respond(rid, { approvalId: 'a1', decision: 'accept_for_session' });

  assert.ok(ctrl.hasConversationScopeGrant('conv-A', 'web_search'));
  assert.equal(ctrl.hasConversationScopeGrant('conv-A', 'bash'), false);
});

test('a plain accept does not record a session grant', () => {
  const ctrl = new ToolApprovalController();
  const rid = 'r3';

  ctrl.setPendingApprovals(rid, [{ ...APPROVAL, approvalId: 'a1' }]);
  ctrl.respond(rid, { approvalId: 'a1', decision: 'accept' });

  assert.equal(ctrl.hasConversationScopeGrant('conv-A', 'bash: echo hi'), false);

  // And a decline neither.
  ctrl.respond(rid, { approvalId: 'a1', decision: 'decline' });
});

test('an approval with no sessionScopeKey cannot mint a grant', () => {
  const ctrl = new ToolApprovalController();
  const rid = 'r4';

  ctrl.setPendingApprovals(rid, [{ approvalId: 'a1', toolCallId: 't1', conversationId: 'conv-A', sessionScopeKey: null }]);
  ctrl.respond(rid, { approvalId: 'a1', decision: 'accept_for_session' });

  assert.equal(ctrl.hasConversationScopeGrant('conv-A', 'null'), false);
  assert.equal(ctrl.hasConversationScopeGrant('conv-A', ''), false);
});

test('responding removes the pending approval', () => {
  const ctrl = new ToolApprovalController();
  const rid = 'r5';

  ctrl.setPendingApprovals(rid, [{ ...APPROVAL, approvalId: 'a1' }]);
  ctrl.respond(rid, { approvalId: 'a1', decision: 'decline' });

  assert.equal(ctrl.getPendingApproval(rid, 'a1'), null);
});

test('responding to an unknown approval returns null', () => {
  const ctrl = new ToolApprovalController();
  assert.equal(ctrl.respond('no-such-request', { approvalId: 'x', decision: 'accept' }), null);
});

test('clearRequest drops the pending set for that request', () => {
  const ctrl = new ToolApprovalController();
  const rid = 'r6';

  ctrl.setPendingApprovals(rid, [{ ...APPROVAL, approvalId: 'a1' }]);
  ctrl.clearRequest(rid);

  assert.equal(ctrl.getPendingApproval(rid, 'a1'), null);
});
