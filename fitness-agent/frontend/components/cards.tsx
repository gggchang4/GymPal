import type { ReactNode } from "react";
import type { AgentCard, CardType, RecommendationFeedbackType } from "@/lib/types";
import { getProposalActionState, type ProposalStatus } from "@/lib/proposal-state";

type ToneConfig = { label: string; tone: string };

const toneByType: Record<CardType, ToneConfig> = {
  health_advice_card: { label: "Health advice", tone: "sage" },
  workout_plan_card: { label: "Workout plan", tone: "sand" },
  exercise_card: { label: "Exercise", tone: "slate" },
  recovery_card: { label: "Recovery", tone: "amber" },
  place_result_card: { label: "Place result", tone: "marine" },
  reasoning_summary_card: { label: "Reasoning", tone: "mist" },
  tool_activity_card: { label: "Tool activity", tone: "mist" },
  action_proposal_card: { label: "Needs confirmation", tone: "marine" },
  action_result_card: { label: "Action result", tone: "sage" },
  weekly_review_card: { label: "Weekly review", tone: "sand" },
  daily_guidance_card: { label: "Daily guidance", tone: "amber" },
  coaching_package_card: { label: "Coaching package", tone: "marine" },
  evidence_card: { label: "Evidence", tone: "mist" },
  memory_candidate_card: { label: "Memory candidate", tone: "sage" },
  outcome_summary_card: { label: "Outcome", tone: "sand" },
  strategy_decision_card: { label: "Strategy", tone: "marine" },
  work_item_card: { label: "Work item", tone: "amber" },
  quality_check_card: { label: "Quality check", tone: "slate" },
  revision_card: { label: "Revision", tone: "marine" },
  coach_workspace_card: { label: "Workspace", tone: "sage" }
};

const terminalWorkItemStatuses = new Set(["dismissed", "converted", "expired"]);

function extractProposalId(card: AgentCard) {
  const proposalId = card.data?.proposalId;
  return typeof proposalId === "string" ? proposalId : "";
}

function extractProposalStatus(card: AgentCard): ProposalStatus {
  const status = card.data?.status;
  return typeof status === "string" ? (status as ProposalStatus) : "pending";
}

function extractProposalGroupId(card: AgentCard) {
  const proposalGroupId = card.data?.proposalGroupId;
  return typeof proposalGroupId === "string" ? proposalGroupId : "";
}

function extractReviewId(card: AgentCard) {
  const reviewId = card.data?.reviewId ?? card.data?.reviewSnapshotId;
  return typeof reviewId === "string" ? reviewId : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstText(data: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = textValue(data[key]);
    if (value) {
      return value;
    }
  }

  return "";
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
}

function firstTextList(data: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = textList(data[key]);
    if (value.length > 0) {
      return value;
    }
  }

  return [];
}

function formatEvidenceValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(" / ");
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 4)
      .map(([key, item]) => `${key}: ${String(item)}`)
      .join(", ");
  }

  return String(value);
}

function evidenceLabel(key: string) {
  const labels: Record<string, string> = {
    adherenceScore: "Adherence",
    memoryCount: "Memory count",
    recommendationTags: "Recommendation tags",
    riskFlags: "Risk flags",
    selectedBecause: "Strategy reason",
    outcome_evidence: "Outcome evidence",
    "Recent outcome evidence": "Outcome evidence",
    "Outcome constraint": "Outcome constraint",
    dataWindow: "Data window",
    sourceEntities: "Source entities",
    policyLabels: "Policy labels"
  };

  return labels[key] ?? key;
}

function collectEvidenceLines(value: unknown): string[] {
  const evidence = asRecord(value);
  const lines: string[] = [];

  for (const [key, item] of Object.entries(evidence)) {
    if (item !== null && item !== undefined && item !== "") {
      lines.push(`${evidenceLabel(key)}: ${formatEvidenceValue(item)}`);
    }
  }

  return lines;
}

function buildEvidenceLines(card: AgentCard): string[] {
  const data = asRecord(card.data);
  const resultSnapshot = asRecord(data.resultSnapshot);
  const preview = asRecord(data.preview);
  const lines: string[] = [];

  lines.push(...collectEvidenceLines(data.evidence));

  for (const key of ["outcome_evidence", "Recent outcome evidence", "Outcome constraint"]) {
    const value = resultSnapshot[key] ?? preview[key];
    if (value !== null && value !== undefined && value !== "") {
      lines.push(`${evidenceLabel(key)}: ${formatEvidenceValue(value)}`);
    }
  }

  return lines.slice(0, 5);
}

function buildMetaTags(card: AgentCard): string[] {
  const data = asRecord(card.data);
  const tags: string[] = [];
  const status = firstText(data, "status");
  const priority = firstText(data, "priority");
  const scope = firstText(data, "scope");
  const source = firstText(data, "source");
  const strategyVersion = firstText(data, "strategyVersion", "strategy_version");
  const riskLevel = firstText(data, "riskLevel", "risk_level");
  const policyLabels = firstTextList(data, "policyLabels", "policy_labels", "passedPolicyLabels", "passed_policy_labels");
  const uncertaintyFlags = firstTextList(data, "uncertaintyFlags", "uncertainty_flags");

  if (status) tags.push(`Status ${status}`);
  if (priority) tags.push(`Priority ${priority}`);
  if (scope) tags.push(`Scope ${scope}`);
  if (source) tags.push(`Source ${source}`);
  if (strategyVersion) tags.push(`Strategy ${strategyVersion}`);
  if (riskLevel) tags.push(`Risk ${riskLevel}`);

  tags.push(...policyLabels.map((label) => `Policy ${label}`));
  tags.push(...uncertaintyFlags.map((flag) => `Uncertainty ${flag}`));

  return tags.slice(0, 8);
}

function formatDateTime(value: string) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    return value;
  }

  return time.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="phase4-card-detail-section">
      <span className="phase4-card-detail-title">{title}</span>
      <ul className="evidence-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function qualityDisplayLabel(status: string) {
  if (status === "blocked") {
    return "Needs more data";
  }

  if (status === "downgraded") {
    return "Conservative version";
  }

  if (status === "passed") {
    return "Ready to show";
  }

  return "Internal check";
}

function WorkItemDetails({ card }: { card: AgentCard }) {
  const data = asRecord(card.data);
  const status = firstText(data, "status") || "pending";
  const priority = firstText(data, "priority") || "medium";
  const reason = firstText(data, "reason");
  const expiresAt = firstText(data, "expiresAt", "expires_at");
  const nextAction = firstText(data, "nextAction", "next_action") || "Open in workspace";
  const isReadOnly = terminalWorkItemStatuses.has(status);

  return (
    <div className="phase4-card-details work-item-card-details">
      <div className="phase4-card-status-grid">
        <div>
          <span>Status</span>
          <strong>{status}</strong>
        </div>
        <div>
          <span>Priority</span>
          <strong>{priority}</strong>
        </div>
        <div>
          <span>Expires</span>
          <strong>{expiresAt ? formatDateTime(expiresAt) : "No deadline"}</strong>
        </div>
      </div>
      {reason ? <p className="phase4-card-note">{reason}</p> : null}
      <p className="phase4-card-note">{isReadOnly ? "This item is read-only after its final state." : `Next step: ${nextAction}`}</p>
    </div>
  );
}

function QualityCheckDetails({ card }: { card: AgentCard }) {
  const data = asRecord(card.data);
  const status = firstText(data, "status") || "passed";
  const blockedReasons = firstTextList(data, "blockedReasons", "blocked_reasons");
  const downgradeReasons = firstTextList(data, "downgradeReasons", "downgrade_reasons");
  const passedLabels = firstTextList(data, "passedPolicyLabels", "passed_policy_labels", "policyLabels", "policy_labels");
  const evidenceLines = collectEvidenceLines(data.evidence).slice(0, 6);

  return (
    <div className="phase4-card-details quality-check-card-details">
      <div className="phase4-card-status-grid">
        <div>
          <span>Status</span>
          <strong>{status}</strong>
        </div>
        <div>
          <span>Display meaning</span>
          <strong>{qualityDisplayLabel(status)}</strong>
        </div>
      </div>
      <DetailList title="Blocked reasons" items={blockedReasons} />
      <DetailList title="Downgrade reasons" items={downgradeReasons} />
      <DetailList title="Passed policy labels" items={passedLabels} />
      <DetailList title="Key evidence" items={evidenceLines} />
    </div>
  );
}

function RevisionDetails({ card }: { card: AgentCard }) {
  const data = asRecord(card.data);
  const sourceReviewId = firstText(data, "sourceReviewId", "source_review_id", "reviewSnapshotId", "review_snapshot_id");
  const sourceProposalGroupId = firstText(data, "sourceProposalGroupId", "source_proposal_group_id", "proposalGroupId", "proposal_group_id");
  const oldSummary = firstText(data, "oldSummary", "previousSummary", "previous_summary", "sourceSummary", "source_summary");
  const newSummary = firstText(data, "newSummary", "revisedSummary", "revised_summary", "targetSummary", "target_summary");
  const changes = firstTextList(data, "changes", "diff", "revisionChanges", "revision_changes");

  return (
    <div className="phase4-card-details revision-card-details">
      <div className="phase4-card-status-grid">
        <div>
          <span>Source review</span>
          <strong>{sourceReviewId || "Not linked"}</strong>
        </div>
        <div>
          <span>Source package</span>
          <strong>{sourceProposalGroupId || "Not linked"}</strong>
        </div>
      </div>
      {oldSummary || newSummary ? (
        <div className="revision-compare-grid">
          <div>
            <span className="phase4-card-detail-title">Previous</span>
            <p>{oldSummary || "No previous summary provided."}</p>
          </div>
          <div>
            <span className="phase4-card-detail-title">Revised</span>
            <p>{newSummary || "No revised summary provided."}</p>
          </div>
        </div>
      ) : null}
      <DetailList title="Revision changes" items={changes} />
    </div>
  );
}

function CoachWorkspaceDetails({ card }: { card: AgentCard }) {
  const data = asRecord(card.data);
  const pendingWorkItems = numberValue(data.pendingWorkItemsCount ?? data.pending_work_items_count);
  const pendingPackage = firstText(data, "pendingPackageTitle", "pending_package_title", "pendingPackage");
  const qualityStatus = firstText(data, "qualityStatus", "quality_status");
  const entryPoints = firstTextList(data, "recommendedEntryPoints", "recommended_entry_points");

  return (
    <div className="phase4-card-details coach-workspace-card-details">
      <div className="phase4-card-status-grid">
        <div>
          <span>Work items</span>
          <strong>{pendingWorkItems === null ? "Unknown" : pendingWorkItems}</strong>
        </div>
        <div>
          <span>Package</span>
          <strong>{pendingPackage || "None pending"}</strong>
        </div>
        <div>
          <span>Quality</span>
          <strong>{qualityStatus || "No checks yet"}</strong>
        </div>
      </div>
      <DetailList title="Recommended entry points" items={entryPoints} />
    </div>
  );
}

function Phase4CardDetails({ card }: { card: AgentCard }) {
  if (card.type === "work_item_card") {
    return <WorkItemDetails card={card} />;
  }

  if (card.type === "quality_check_card") {
    return <QualityCheckDetails card={card} />;
  }

  if (card.type === "revision_card") {
    return <RevisionDetails card={card} />;
  }

  if (card.type === "coach_workspace_card") {
    return <CoachWorkspaceDetails card={card} />;
  }

  return null;
}

export function InfoCard({
  title,
  description,
  bullets,
  kicker,
  tone = "mist",
  children
}: {
  title: string;
  description: string;
  bullets?: string[];
  kicker?: string;
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <article className={`info-card tone-${tone}`}>
      {kicker ? <span className="info-kicker">{kicker}</span> : null}
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      {bullets && bullets.length > 0 ? (
        <ul className="info-list">
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      ) : null}
      {children}
    </article>
  );
}

export function AgentCardList({
  cards,
  onApproveProposal,
  onRejectProposal,
  onApproveProposalGroup,
  onRejectProposalGroup,
  onSubmitRecommendationFeedback,
  pendingProposalId
}: {
  cards: AgentCard[];
  onApproveProposal?: (proposalId: string) => void;
  onRejectProposal?: (proposalId: string) => void;
  onApproveProposalGroup?: (proposalGroupId: string) => void;
  onRejectProposalGroup?: (proposalGroupId: string) => void;
  onSubmitRecommendationFeedback?: (payload: {
    reviewSnapshotId?: string | null;
    proposalGroupId?: string | null;
    feedbackType: RecommendationFeedbackType;
  }) => void;
  pendingProposalId?: string | null;
}) {
  return (
    <div className="cards-stack">
      {cards.map((card, index) => {
        const proposalId = extractProposalId(card);
        const proposalGroupId = extractProposalGroupId(card);
        const reviewSnapshotId = extractReviewId(card);
        const proposalStatus = extractProposalStatus(card);
        const isProposal = card.type === "action_proposal_card" && proposalId;
        const isProposalGroup = card.type === "coaching_package_card" && proposalGroupId;
        const actionState = getProposalActionState(proposalStatus, pendingProposalId, proposalId);
        const groupActionState = getProposalActionState(proposalStatus, pendingProposalId, proposalGroupId);
        const metaTags = buildMetaTags(card);
        const evidenceLines = buildEvidenceLines(card);
        const tone = toneByType[card.type];
        const canSubmitFeedback =
          Boolean(onSubmitRecommendationFeedback) &&
          ["weekly_review_card", "daily_guidance_card", "coaching_package_card"].includes(card.type) &&
          (Boolean(reviewSnapshotId) || Boolean(proposalGroupId));

        return (
          <InfoCard
            key={`${card.type}-${index}-${proposalId || proposalGroupId || "card"}`}
            title={card.title}
            description={card.description}
            bullets={card.bullets}
            kicker={tone.label}
            tone={tone.tone}
          >
            {metaTags.length > 0 ? (
              <div className="evidence-tag-row">
                {metaTags.map((tag) => (
                  <span key={tag} className="evidence-tag">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
            {evidenceLines.length > 0 ? (
              <div className="evidence-block">
                <span className="evidence-title">Evidence</span>
                <ul className="evidence-list">
                  {evidenceLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Phase4CardDetails card={card} />
            {isProposal ? (
              <div className="action-row">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!actionState.canReject}
                  onClick={() => onRejectProposal?.(proposalId)}
                >
                  {actionState.rejectLabel}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={!actionState.canAct}
                  onClick={() => onApproveProposal?.(proposalId)}
                >
                  {actionState.approveLabel}
                </button>
              </div>
            ) : null}
            {isProposalGroup ? (
              <div className="action-row">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!groupActionState.canReject}
                  onClick={() => onRejectProposalGroup?.(proposalGroupId)}
                >
                  {groupActionState.rejectLabel}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={!groupActionState.canAct}
                  onClick={() => onApproveProposalGroup?.(proposalGroupId)}
                >
                  {groupActionState.approveLabel}
                </button>
              </div>
            ) : null}
            {canSubmitFeedback ? (
              <div className="action-row">
                <button
                  type="button"
                  className="chip-button"
                  disabled={Boolean(pendingProposalId)}
                  onClick={() =>
                    onSubmitRecommendationFeedback?.({
                      reviewSnapshotId: reviewSnapshotId || null,
                      proposalGroupId: proposalGroupId || null,
                      feedbackType: "helpful"
                    })
                  }
                >
                  Helpful
                </button>
                <button
                  type="button"
                  className="chip-button"
                  disabled={Boolean(pendingProposalId)}
                  onClick={() =>
                    onSubmitRecommendationFeedback?.({
                      reviewSnapshotId: reviewSnapshotId || null,
                      proposalGroupId: proposalGroupId || null,
                      feedbackType: "too_hard"
                    })
                  }
                >
                  Too hard
                </button>
                <button
                  type="button"
                  className="chip-button"
                  disabled={Boolean(pendingProposalId)}
                  onClick={() =>
                    onSubmitRecommendationFeedback?.({
                      reviewSnapshotId: reviewSnapshotId || null,
                      proposalGroupId: proposalGroupId || null,
                      feedbackType: "unclear"
                    })
                  }
                >
                  Unclear
                </button>
              </div>
            ) : null}
          </InfoCard>
        );
      })}
    </div>
  );
}
