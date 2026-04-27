export type ProposalStatus = "pending" | "approved" | "executed" | "rejected" | "failed" | "expired" | "executing";

export interface ProposalActionState {
  canAct: boolean;
  canReject: boolean;
  approveLabel: string;
  rejectLabel: string;
}

export function getProposalActionState(
  status: ProposalStatus,
  pendingProposalId?: string | null,
  proposalId?: string
): ProposalActionState {
  if (pendingProposalId && proposalId && pendingProposalId === proposalId) {
    return { canAct: false, canReject: false, approveLabel: "处理中...", rejectLabel: "处理中..." };
  }

  if (status === "pending") {
    return { canAct: true, canReject: true, approveLabel: "确认执行", rejectLabel: "拒绝" };
  }

  if (status === "approved") {
    return { canAct: true, canReject: false, approveLabel: "继续执行", rejectLabel: "已锁定" };
  }

  if (status === "executing") {
    return { canAct: false, canReject: false, approveLabel: "执行中", rejectLabel: "已锁定" };
  }

  return { canAct: false, canReject: false, approveLabel: "已结束", rejectLabel: "已结束" };
}
