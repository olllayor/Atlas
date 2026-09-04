import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolApprovalController, type PendingApproval } from '../src/main/ai/core/ToolApprovalController.js';

const APPROVAL: PendingApproval = {
  approvalId: 'a1',
  conversationId: 'c1',
  sessionScopeKey: 'shell:bash',
  toolName: 'bash',
  toolType: 'shell',
};

test('accept_for_session records a grant only for the conversation that granted it', () => {
  const ctrl = new ToolApprovalController();
  const rid = 'r1';

  ctrl.setPendingApprovals(rid, [APPROVAL]);
  ctrl.respond(rid, { approvalId: 'a1', decision: 'accept_for_session' });

  assert.equal(ctrl.hasConversationScopeGrant('c1', 'shell:bash'), true);
  assert.equal(ctrl.hasConversationScopeGrant('c2', 'shell:bash'), false);
});

test('a grant for one scope key does not cover a different key', () => {
  const ctrl = new ToolApprovalController();
  const rid = 'r2';

  ctrl.setPendingApprovals(rid, [APPROVAL]);
  ctrl.respond(rid, { approvalId: 'a1', decision: 'accept_for_session' });

  assert.equal(ctrl.hasConversationScopeGrant('c1', 'shell:bash'), true);
  assert.equal(ctrl.hasConversationScopeGrant('c1', 'filesystem:write_file'), false);
});

test('a plain accept does not record a session grant', () => {
  const ctrl = new ToolApprovalController();
  const rid = 'r3';

  ctrl.setPendingApprovals(rid, [APPROVAL]);
  ctrl.respond(rid, { approvalId: 'a1', decision: 'accept' });

  assert.equal(ctrl.hasConversationScopeGrant('c1', 'shell:bash'), false);
});

test('an approval with no sessionScopeKey cannot mint a grant', () => {
  const ctrl = new ToolApprovalController();
  const rid = 'r4';

  ctrl.setPendingApprovals(rid, [{ ...APPROVAL, sessionScopeKey: null }]);
  ctrl.respond(rid, { approvalId: 'a1', decision: 'accept_for_session' });

  assert.equal(ctrl.hasConversationScopeGrant('c1', 'shell:bash'), false);
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

test('getPendingApprovals and hasPendingApprovals track multi-approval batches', () => {
  const ctrl = new ToolApprovalController();
  const rid = 'r7';

  assert.equal(ctrl.hasPendingApprovals(rid), false);
  assert.deepEqual(ctrl.getPendingApprovals(rid), []);

  ctrl.setPendingApprovals(rid, [
    { ...APPROVAL, approvalId: 'a1' },
    { ...APPROVAL, approvalId: 'a2', sessionScopeKey: 'network:web_fetch', toolName: 'web_fetch', toolType: 'network' },
  ]);

  assert.equal(ctrl.hasPendingApprovals(rid), true);
  assert.equal(ctrl.getPendingApprovals(rid).length, 2);

  ctrl.respond(rid, { approvalId: 'a1', decision: 'accept' });
  assert.equal(ctrl.hasPendingApprovals(rid), true);
  assert.equal(ctrl.getPendingApprovals(rid).length, 1);
  assert.equal(ctrl.getPendingApprovals(rid)[0].approvalId, 'a2');

  ctrl.respond(rid, { approvalId: 'a2', decision: 'accept' });
  assert.equal(ctrl.hasPendingApprovals(rid), false);
  assert.deepEqual(ctrl.getPendingApprovals(rid), []);
});
