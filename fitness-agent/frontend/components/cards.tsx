import type { ReactNode } from "react";
import type { AgentCard, CardType, ProposalDiff, RecommendationFeedbackType } from "@/lib/types";
import { getProposalActionState, type ProposalStatus } from "@/lib/proposal-state";

type ToneConfig = { label: string; tone: string };

const toneByType: Record<CardType, ToneConfig> = {
  health_advice_card: { label: "健康建议", tone: "sage" },
  workout_plan_card: { label: "训练计划", tone: "sand" },
  exercise_card: { label: "动作", tone: "slate" },
  recovery_card: { label: "恢复", tone: "amber" },
  place_result_card: { label: "地点结果", tone: "marine" },
  reasoning_summary_card: { label: "思路摘要", tone: "mist" },
  tool_activity_card: { label: "处理过程", tone: "mist" },
  action_proposal_card: { label: "需要确认", tone: "marine" },
  action_result_card: { label: "执行结果", tone: "sage" },
  weekly_review_card: { label: "周复盘", tone: "sand" },
  daily_guidance_card: { label: "今日指导", tone: "amber" },
  coaching_package_card: { label: "教练包", tone: "marine" },
  evidence_card: { label: "依据", tone: "mist" },
  memory_candidate_card: { label: "记忆候选", tone: "sage" },
  outcome_summary_card: { label: "效果摘要", tone: "sand" },
  strategy_decision_card: { label: "策略", tone: "marine" },
  work_item_card: { label: "待处理事项", tone: "amber" },
  quality_check_card: { label: "质量检查", tone: "slate" },
  revision_card: { label: "调整建议", tone: "marine" },
  coach_workspace_card: { label: "工作台", tone: "sage" }
};

const hiddenUserCardTypes = new Set<CardType>(["reasoning_summary_card", "tool_activity_card"]);

const terminalWorkItemStatuses = new Set(["dismissed", "converted", "expired"]);

const statusLabels: Record<string, string> = {
  pending: "待确认",
  approved: "已确认",
  executed: "已执行",
  rejected: "已拒绝",
  failed: "执行失败",
  expired: "已过期",
  executing: "执行中",
  dismissed: "已关闭",
  converted: "已转为提案",
  blocked: "需要补充信息",
  downgraded: "保守版本",
  passed: "可展示"
};

const priorityLabels: Record<string, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

const riskLabels: Record<string, string> = {
  high: "高风险",
  medium: "中风险",
  low: "低风险"
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
    adherenceScore: "执行度",
    memoryCount: "使用记忆数",
    recommendationTags: "建议标签",
    riskFlags: "风险标记",
    selectedBecause: "策略依据",
    outcome_evidence: "效果依据",
    "Recent outcome evidence": "效果依据",
    "Outcome constraint": "效果约束",
    dataWindow: "数据窗口",
    sourceEntities: "来源数据",
    policyLabels: "策略标签"
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

function displayStatus(value: string) {
  return statusLabels[value] ?? value;
}

function displayPriority(value: string) {
  return priorityLabels[value] ?? value;
}

function displayRisk(value: string) {
  return riskLabels[value] ?? value;
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

  if (status) tags.push(`状态 ${displayStatus(status)}`);
  if (priority) tags.push(`优先级 ${displayPriority(priority)}`);
  if (scope) tags.push(`范围 ${scope}`);
  if (source) tags.push(`来源 ${source}`);
  if (strategyVersion) tags.push(`策略 ${strategyVersion}`);
  if (riskLevel) tags.push(`风险 ${displayRisk(riskLevel)}`);

  tags.push(...policyLabels.map((label) => `策略 ${label}`));
  tags.push(...uncertaintyFlags.map((flag) => `待确认 ${flag}`));

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
    <div className="agent-card-detail-section">
      <span className="agent-card-detail-title">{title}</span>
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
    return "需要补充信息";
  }

  if (status === "downgraded") {
    return "保守版本";
  }

  if (status === "passed") {
    return "可展示";
  }

  return "已检查";
}

function WorkItemDetails({ card }: { card: AgentCard }) {
  const data = asRecord(card.data);
  const status = firstText(data, "status") || "pending";
  const priority = firstText(data, "priority") || "medium";
  const reason = firstText(data, "reason");
  const expiresAt = firstText(data, "expiresAt", "expires_at");
  const nextAction = firstText(data, "nextAction", "next_action") || "打开工作台继续处理";
  const isReadOnly = terminalWorkItemStatuses.has(status);

  return (
    <div className="agent-card-details work-item-card-details">
      <div className="agent-card-status-grid">
        <div>
          <span>状态</span>
          <strong>{displayStatus(status)}</strong>
        </div>
        <div>
          <span>优先级</span>
          <strong>{displayPriority(priority)}</strong>
        </div>
        <div>
          <span>截止</span>
          <strong>{expiresAt ? formatDateTime(expiresAt) : "无截止时间"}</strong>
        </div>
      </div>
      {reason ? <p className="agent-card-note">{reason}</p> : null}
      <p className="agent-card-note">{isReadOnly ? "该事项已结束，仅供回顾。" : `下一步：${nextAction}`}</p>
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
    <div className="agent-card-details quality-check-card-details">
      <div className="agent-card-status-grid">
        <div>
          <span>状态</span>
          <strong>{displayStatus(status)}</strong>
        </div>
        <div>
          <span>含义</span>
          <strong>{qualityDisplayLabel(status)}</strong>
        </div>
      </div>
      <DetailList title="阻断原因" items={blockedReasons} />
      <DetailList title="降级原因" items={downgradeReasons} />
      <DetailList title="通过策略" items={passedLabels} />
      <DetailList title="关键依据" items={evidenceLines} />
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
    <div className="agent-card-details revision-card-details">
      <div className="agent-card-status-grid">
        <div>
          <span>来源复盘</span>
          <strong>{sourceReviewId || "未关联"}</strong>
        </div>
        <div>
          <span>来源教练包</span>
          <strong>{sourceProposalGroupId || "未关联"}</strong>
        </div>
      </div>
      {oldSummary || newSummary ? (
        <div className="revision-compare-grid">
          <div>
            <span className="agent-card-detail-title">调整前</span>
            <p>{oldSummary || "暂无调整前摘要。"}</p>
          </div>
          <div>
            <span className="agent-card-detail-title">调整后</span>
            <p>{newSummary || "暂无调整后摘要。"}</p>
          </div>
        </div>
      ) : null}
      <DetailList title="调整内容" items={changes} />
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
    <div className="agent-card-details coach-workspace-card-details">
      <div className="agent-card-status-grid">
        <div>
          <span>待处理</span>
          <strong>{pendingWorkItems === null ? "未知" : pendingWorkItems}</strong>
        </div>
        <div>
          <span>教练包</span>
          <strong>{pendingPackage || "无待确认"}</strong>
        </div>
        <div>
          <span>质量</span>
          <strong>{qualityStatus ? qualityDisplayLabel(qualityStatus) : "暂无检查"}</strong>
        </div>
      </div>
      <DetailList title="建议入口" items={entryPoints} />
    </div>
  );
}

function ProductCardDetails({ card }: { card: AgentCard }) {
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

function stringifyCompact(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item))).join(" / ");
  }

  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }

  return value === undefined || value === null || value === "" ? "未设置" : String(value);
}

function buildProposalDiffs(card: AgentCard): ProposalDiff[] {
  const data = asRecord(card.data);
  const payload = asRecord(data.payload);
  const preview = asRecord(data.preview);
  const actionType = firstText(data, "actionType", "action_type");

  if (actionType === "update_plan_day") {
    return [
      { label: "重点", before: stringifyCompact(preview.oldFocus), after: stringifyCompact(payload.focus ?? preview.newFocus) },
      { label: "时长", before: stringifyCompact(preview.oldDuration), after: stringifyCompact(payload.duration) },
      { label: "动作", before: stringifyCompact(preview.oldExercises), after: stringifyCompact(payload.exercises) }
    ].filter((item) => item.before !== "未设置" || item.after !== "未设置");
  }

  if (actionType === "generate_diet_snapshot") {
    return [
      { label: "热量", before: stringifyCompact(preview.oldTargetCalorie), after: stringifyCompact(payload.targetCalorie ?? preview.targetCalorie) },
      { label: "蛋白质", before: stringifyCompact(preview.oldProteinGrams), after: stringifyCompact(payload.proteinGrams ?? preview.proteinGrams) },
      { label: "餐次策略", before: stringifyCompact(preview.oldMealStrategy), after: stringifyCompact(payload.mealStrategy ?? preview.mealStrategy) }
    ].filter((item) => item.before !== "未设置" || item.after !== "未设置");
  }

  if (actionType === "create_coaching_memory" || actionType === "update_coaching_memory") {
    return [
      { label: "记忆", before: stringifyCompact(preview.old), after: stringifyCompact(payload.summary ?? preview.new ?? preview.summary) },
      { label: "分类", before: stringifyCompact(preview.oldCategory), after: stringifyCompact(payload.category ?? preview.category) }
    ].filter((item) => item.before !== "未设置" || item.after !== "未设置");
  }

  if (actionType === "generate_plan" || actionType === "generate_next_week_plan" || actionType === "adjust_plan") {
    return [
      { label: "目标", before: stringifyCompact(preview.oldGoal), after: stringifyCompact(payload.goal ?? preview.goal) },
      { label: "训练日", before: stringifyCompact(preview.oldDays), after: stringifyCompact(payload.days ?? preview.days) },
      { label: "进阶策略", before: stringifyCompact(preview.oldProgression), after: stringifyCompact(payload.progression ?? preview.progression) }
    ].filter((item) => item.before !== "未设置" || item.after !== "未设置");
  }

  return [];
}

function ProposalDiffDetails({ card }: { card: AgentCard }) {
  const diffs = buildProposalDiffs(card);
  if (diffs.length === 0) {
    return null;
  }

  return (
    <div className="proposal-diff">
      <span className="agent-card-detail-title">调整前 / 调整后</span>
      {diffs.map((diff) => (
        <div className="proposal-diff-row" key={diff.label}>
          <strong>{diff.label}</strong>
          <span>{diff.before ?? "未设置"}</span>
          <span>{diff.after ?? "未设置"}</span>
        </div>
      ))}
    </div>
  );
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
  const visibleCards = cards.filter((card) => !hiddenUserCardTypes.has(card.type));

  if (visibleCards.length === 0) {
    return null;
  }

  return (
    <div className="cards-stack">
      {visibleCards.map((card, index) => {
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
                <span className="evidence-title">依据</span>
                <ul className="evidence-list">
                  {evidenceLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ProductCardDetails card={card} />
            {isProposal ? <ProposalDiffDetails card={card} /> : null}
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
                  太难了
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
