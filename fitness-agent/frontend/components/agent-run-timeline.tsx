import type { AgentRunTimelineItem } from "@/lib/types";

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
    const stage = typeof item.payload.stage === "string" ? item.payload.stage : "llm";
    const ok = item.payload.ok === false ? "failed" : "ok";
    return `${stage} ${ok}`;
  }

  if (item.stepType === "intent_classification") {
    const intent = typeof item.payload.intent === "string" ? item.payload.intent : "intent";
    return intent;
  }

  if (item.stepType === "planner_decision") {
    const action = typeof item.payload.action === "string" ? item.payload.action : "planner";
    return action;
  }

  return item.stepType.replaceAll("_", " ");
}

export function AgentRunTimeline({ items }: { items: AgentRunTimelineItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="agent-run-timeline" aria-label="Agent run timeline">
      {items.map((item) => (
        <div className={`agent-run-timeline-item status-${statusForItem(item)}`} key={`${item.runId}-${item.id}`}>
          <span className="agent-run-timeline-dot" />
          <div>
            <strong>{item.title || labelForItem(item)}</strong>
            <small>{labelForItem(item)}</small>
          </div>
        </div>
      ))}
    </div>
  );
}
