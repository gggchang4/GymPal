import type { ReactNode } from "react";
import type { AgentCard, RecommendationFeedbackType } from "@/lib/types";
import { getProposalActionState, type ProposalStatus } from "@/lib/proposal-state";

const toneByType: Record<AgentCard["type"], { label: string; tone: string }> = {
  health_advice_card: { label: "健康建议", tone: "sage" },
  workout_plan_card: { label: "训练计划", tone: "sand" },
  exercise_card: { label: "动作说明", tone: "slate" },
  recovery_card: { label: "恢复建议", tone: "amber" },
  place_result_card: { label: "地点结果", tone: "marine" },
  reasoning_summary_card: { label: "推理摘要", tone: "mist" },
  tool_activity_card: { label: "工具活动", tone: "mist" },
  action_proposal_card: { label: "待确认操作", tone: "marine" },
  action_result_card: { label: "执行结果", tone: "sage" },
  weekly_review_card: { label: "周复盘", tone: "sand" },
  daily_guidance_card: { label: "今日建议", tone: "amber" },
  coaching_package_card: { label: "教练包", tone: "marine" },
  evidence_card: { label: "建议依据", tone: "mist" },
  memory_candidate_card: { label: "记忆候选", tone: "sage" },
  outcome_summary_card: { label: "效果评估", tone: "sand" },
  strategy_decision_card: { label: "策略选择", tone: "marine" }
};

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

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
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
    adherenceScore: "完成度",
    memoryCount: "记忆数量",
    recommendationTags: "建议标签",
    riskFlags: "风险信号",
    selectedBecause: "策略选择原因",
    outcome_evidence: "建议效果依据",
    "Recent outcome evidence": "建议效果依据",
    "Outcome constraint": "效果约束"
  };

  return labels[key] ?? key;
}

function buildEvidenceLines(card: AgentCard): string[] {
  const data = asRecord(card.data);
  const evidence = asRecord(data.evidence);
  const resultSnapshot = asRecord(data.resultSnapshot);
  const preview = asRecord(data.preview);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(evidence)) {
    if (value !== null && value !== undefined && value !== "") {
      lines.push(`${evidenceLabel(key)}: ${formatEvidenceValue(value)}`);
    }
  }

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
  const strategyVersion = typeof data.strategyVersion === "string" ? data.strategyVersion : "";
  const policyLabels = textList(data.policyLabels);
  const uncertaintyFlags = textList(data.uncertaintyFlags);
  const riskLevel = typeof data.riskLevel === "string" ? data.riskLevel : "";

  if (strategyVersion) {
    tags.push(`策略版本 ${strategyVersion}`);
  }

  if (riskLevel) {
    tags.push(`风险 ${riskLevel}`);
  }

  tags.push(...policyLabels.map((label) => `策略标签 ${label}`));
  tags.push(...uncertaintyFlags.map((flag) => `不确定性 ${flag}`));

  return tags.slice(0, 8);
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
        const tone = toneByType[card.type] ?? { label: "结果", tone: "mist" };
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
                <span className="evidence-title">依据</span>
                <ul className="evidence-list">
                  {evidenceLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
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
                  有帮助
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
                  太难
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
                  不清楚
                </button>
              </div>
            ) : null}
          </InfoCard>
        );
      })}
    </div>
  );
}
