export const proposalStatuses = {
  pending: "pending",
  approved: "approved",
  executed: "executed",
  rejected: "rejected",
  expired: "expired",
  failed: "failed",
  superseded: "superseded",
  stale: "stale"
} as const;

export const proposalTerminalStatuses = [
  proposalStatuses.rejected,
  proposalStatuses.expired,
  proposalStatuses.failed,
  proposalStatuses.superseded,
  proposalStatuses.stale
] as const;

export const executableProposalStatuses = [proposalStatuses.pending, proposalStatuses.approved] as const;

export const proposalGroupStatuses = proposalStatuses;
export const proposalGroupTerminalStatuses = proposalTerminalStatuses;
export const executableProposalGroupStatuses = executableProposalStatuses;

export const workItemStatuses = {
  pending: "pending",
  opened: "opened",
  dismissed: "dismissed",
  converted: "converted",
  expired: "expired"
} as const;

export const activeWorkItemStatuses = [workItemStatuses.pending, workItemStatuses.opened] as const;

export function isTerminalProposalStatus(status: string) {
  return proposalTerminalStatuses.includes(status as (typeof proposalTerminalStatuses)[number]);
}

export function isExecutableProposalStatus(status: string) {
  return executableProposalStatuses.includes(status as (typeof executableProposalStatuses)[number]);
}

export function isActiveWorkItemStatus(status: string) {
  return activeWorkItemStatuses.includes(status as (typeof activeWorkItemStatuses)[number]);
}
