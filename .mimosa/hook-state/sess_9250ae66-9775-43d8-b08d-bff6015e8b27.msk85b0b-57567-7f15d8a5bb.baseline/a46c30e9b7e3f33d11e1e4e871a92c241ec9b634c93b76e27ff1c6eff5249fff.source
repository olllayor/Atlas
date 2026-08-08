import type { ApprovalDecision } from '../../../shared/contracts';

type PendingApproval = {
  approvalId: string;
  toolCallId: string;
  conversationId: string;
  toolName?: string;
  toolType?: string | null;
  reason?: string;
  sessionScopeKey?: string | null;
};

type ApprovalResponse = {
  approvalId: string;
  decision: ApprovalDecision;
  reason?: string;
};

/**
 * Holds pending tool approvals and records "always allow for this session"
 * grants.
 *
 * Semantics that callers (and the UI copy) must not drift from:
 * - A grant is **conversation-scoped**: `accept_for_session` records the scope
 *   key only against the conversation that granted it, never any other.
 * - A grant is **per-runtime-session and ephemeral**: it lives in an in-memory
 *   `Map` and is forgotten on restart. This is a deliberate privacy posture —
 *   mirroring t3code's "session" semantics — and is the reason the approval UI
 *   should say "until you quit Atlas", not "forever". Persistence would be a
 *   product change requiring a real table (see R4 in docs/plans/t3code-borrow).
 * - A plain `accept` or `decline` never records a grant; only `accept_for_session`
 *   does, and only when the approval carries a `sessionScopeKey`.
 */
export class ToolApprovalController {
  private readonly pendingByRequest = new Map<string, Map<string, PendingApproval>>();
  private readonly grantedScopesByConversation = new Map<string, Set<string>>();

  setPendingApprovals(requestId: string, approvals: PendingApproval[]) {
    const next = new Map<string, PendingApproval>();
    for (const approval of approvals) {
      next.set(approval.approvalId, approval);
    }
    this.pendingByRequest.set(requestId, next);
  }

  hasConversationScopeGrant(conversationId: string, scopeKey: string) {
    return this.grantedScopesByConversation.get(conversationId)?.has(scopeKey) ?? false;
  }

  getPendingApproval(requestId: string, approvalId: string) {
    return this.pendingByRequest.get(requestId)?.get(approvalId) ?? null;
  }

  clearRequest(requestId: string) {
    this.pendingByRequest.delete(requestId);
  }

  respond(requestId: string, response: ApprovalResponse) {
    const pending = this.getPendingApproval(requestId, response.approvalId);
    if (!pending) {
      return null;
    }

    this.pendingByRequest.get(requestId)?.delete(response.approvalId);

    if (response.decision === 'accept_for_session' && pending.sessionScopeKey) {
      const existing = this.grantedScopesByConversation.get(pending.conversationId);
      if (existing) {
        existing.add(pending.sessionScopeKey);
      } else {
        this.grantedScopesByConversation.set(pending.conversationId, new Set([pending.sessionScopeKey]));
      }
    }

    return {
      ...pending,
      decision: response.decision,
      reason: response.reason,
    };
  }
}
