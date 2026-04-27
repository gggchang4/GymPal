import type { ReactNode } from "react";
import type { AgentCard } from "@/lib/types";
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
  coaching_package_card: { label: "教练包", tone: "marine" }
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
  pendingProposalId
}: {
  cards: AgentCard[];
  onApproveProposal?: (proposalId: string) => void;
  onRejectProposal?: (proposalId: string) => void;
  onApproveProposalGroup?: (proposalGroupId: string) => void;
  onRejectProposalGroup?: (proposalGroupId: string) => void;
  pendingProposalId?: string | null;
}) {
  return (
    <div className="cards-stack">
      {cards.map((card, index) => {
        const proposalId = extractProposalId(card);
        const proposalGroupId = extractProposalGroupId(card);
        const proposalStatus = extractProposalStatus(card);
        const isProposal = card.type === "action_proposal_card" && proposalId;
        const isProposalGroup = card.type === "coaching_package_card" && proposalGroupId;
        const actionState = getProposalActionState(proposalStatus, pendingProposalId, proposalId);
        const groupActionState = getProposalActionState(proposalStatus, pendingProposalId, proposalGroupId);
        const tone = toneByType[card.type] ?? { label: "结果", tone: "mist" };

        return (
          <InfoCard
            key={`${card.type}-${index}-${proposalId || proposalGroupId || "card"}`}
            title={card.title}
            description={card.description}
            bullets={card.bullets}
            kicker={tone.label}
            tone={tone.tone}
          >
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
          </InfoCard>
        );
      })}
    </div>
  );
}
