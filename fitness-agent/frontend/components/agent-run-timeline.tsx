import type { AgentRunTimelineItem } from "@/lib/types";

const stepTypeLabels: Record<string, string> = {
  intent_classification: "理解意图",
  planner_decision: "规划下一步",
  llm_call: "模型调用",
  tool_call_started: "开始读取",
  tool_call_completed: "读取完成",
  degraded_mode: "受限模式"
};

const plannerActionLabels: Record<string, string> = {
  answer: "直接回答",
  clarify: "需要澄清",
  propose: "生成待确认提案",
  legacy_route: "兼容处理"
};

function statusForItem(item: AgentRunTimelineItem) {
  if (item.stepType === "tool_call_completed") {
    return item.payload?.payload && typeof item.payload.payload === "object" && "ok" in item.payload.payload
      ? (item.payload.payload as { ok?: unknown }).ok === false
        ? "failed"
        : "done"
      : "done";
  }

  if (item.stepType === "degraded_mode") return "limited";
  if (item.stepType === "tool_call_started") return "running";
  return "done";
}

function labelForItem(item: AgentRunTimelineItem) {
  if (item.stepType === "llm_call") {
    return item.payload.ok === false ? "模型调用失败" : "模型调用完成";
  }

  if (item.stepType === "intent_classification") {
    const intent = typeof item.payload.intent === "string" ? item.payload.intent : "intent";
    return `意图：${intent}`;
  }

  if (item.stepType === "planner_decision") {
    const action = typeof item.payload.action === "string" ? item.payload.action : "planner";
    return `决策：${plannerActionLabels[action] ?? action}`;
  }

  return stepTypeLabels[item.stepType] ?? item.stepType.replaceAll("_", " ");
}

export function AgentRunTimeline({ items }: { items: AgentRunTimelineItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="agent-run-timeline" aria-label="Agent 工作进度">
      {items.map((item) => (
        <div className={`agent-run-timeline-item status-${statusForItem(item)}`} key={`${item.runId}-${item.id}`}>
          <span className="agent-run-timeline-dot" />
          <div>
            <strong>{item.title || stepTypeLabels[item.stepType] || labelForItem(item)}</strong>
            <small>{labelForItem(item)}</small>
          </div>
        </div>
      ))}
    </div>
  );
}
