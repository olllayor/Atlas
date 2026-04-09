type PendingApproval = {
  approvalId: string;
  toolCallId: string;
  toolName?: string;
  reason?: string;
};

type ApprovalResponse = {
  approvalId: string;
  approved: boolean;
  reason?: string;
};

export class ToolApprovalController {
  private readonly pendingByRequest = new Map<string, Map<string, PendingApproval>>();

  setPendingApprovals(requestId: string, approvals: PendingApproval[]) {
    const next = new Map<string, PendingApproval>();
    for (const approval of approvals) {
      next.set(approval.approvalId, approval);
    }
    this.pendingByRequest.set(requestId, next);
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
    return {
      ...pending,
      approved: response.approved,
      reason: response.reason,
    };
  }
}

