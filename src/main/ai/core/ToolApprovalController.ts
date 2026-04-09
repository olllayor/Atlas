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
