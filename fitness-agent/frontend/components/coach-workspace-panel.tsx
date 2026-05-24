"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { convertAgentWorkItem, dismissAgentWorkItem, openAgentWorkItem, refreshAgentWorkItems } from "@/lib/api";
import { readAgentThreadId, writeAgentIntentHint, writeAgentThreadId } from "@/lib/agent-thread";
import { appRoutes, type AppRoute } from "@/lib/routes";
import type { AgentWorkItemSnapshot, WorkspaceSummarySnapshot } from "@/lib/types";

const typeLabels: Record<string, string> = {
  weekly_review_due: "周复盘",
  daily_guidance_due: "今日指导",
  log_gap: "日志待补",
  pending_package: "待确认教练包",
  memory_candidate: "记忆候选",
  outcome_refresh_due: "效果追踪",
  revision_suggested: "调整建议"
};

const priorityLabels: Record<string, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

type BusyAction = {
  id: string;
  action: "open" | "dismiss" | "convert";
};

function routeForNavigation(route: string): AppRoute {
  if (route === "logs") return appRoutes.logs;
  if (route === "plans") return appRoutes.planCurrent;
  if (route === "dashboard") return appRoutes.dashboard;
  return appRoutes.chat;
}

function formatTime(value?: string | null) {
  if (!value) {
    return "无截止时间";
  }

  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function qualityDisplayLabel(status: string) {
  if (status === "blocked") return "需要补充信息";
  if (status === "downgraded") return "保守版本";
  if (status === "passed") return "可展示";
  return "已检查";
}

function intentHintForWorkItem(item: AgentWorkItemSnapshot) {
  if (item.type === "weekly_review_due") return "从工作台继续：生成本周复盘教练包。";
  if (item.type === "daily_guidance_due") return "从工作台继续：生成今天的训练与饮食指导。";
  if (item.type === "memory_candidate") return "从工作台继续：检查待确认的记忆候选。";
  if (item.type === "pending_package") return "从工作台继续：处理待确认的教练包。";
  if (item.type === "revision_suggested") return "从工作台继续：查看建议调整。";
  return `从工作台继续：${item.title}`;
}

export function CoachWorkspacePanel({ workspace }: { workspace: WorkspaceSummarySnapshot }) {
  const router = useRouter();
  const [items, setItems] = useState<AgentWorkItemSnapshot[]>(workspace.pendingWorkItems);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function handleRefresh() {
    setIsRefreshing(true);
    setError("");
    setNotice("");

    try {
      const result = await refreshAgentWorkItems();
      setItems(result.pending);
      setNotice(`已新增 ${result.created.length} 项，更新 ${result.updated.length} 项，跳过 ${result.skipped.length} 项。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法刷新工作台事项。");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleOpen(item: AgentWorkItemSnapshot) {
    setBusyAction({ id: item.id, action: "open" });
    setError("");

    try {
      const result = await openAgentWorkItem(item.id);
      setItems((current) => current.map((entry) => (entry.id === item.id ? result.workItem : entry)));
      if (result.workItem.relatedThreadId) {
        writeAgentThreadId(result.workItem.relatedThreadId);
      } else if (!readAgentThreadId() && result.navigation.route === "chat") {
        setNotice("已进入聊天，可以用新对话继续处理这个事项。");
      }
      writeAgentIntentHint(intentHintForWorkItem(result.workItem));

      startTransition(() => {
        router.push(routeForNavigation(result.navigation.route));
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法打开这个事项。");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDismiss(item: AgentWorkItemSnapshot) {
    setBusyAction({ id: item.id, action: "dismiss" });
    setError("");
    setNotice("");

    try {
      await dismissAgentWorkItem(item.id, "dismissed_from_dashboard");
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setNotice("事项已关闭，类似提醒会暂时降频。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法关闭这个事项。");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConvert(item: AgentWorkItemSnapshot) {
    setBusyAction({ id: item.id, action: "convert" });
    setError("");
    setNotice("");

    try {
      const result = await convertAgentWorkItem(item.id, {
        requestId: item.requestId,
        revisionReason: "dashboard_work_item"
      });
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      const threadId = item.relatedThreadId || result.conversion.proposalGroup?.threadId;
      if (threadId) {
        writeAgentThreadId(threadId);
      }
      writeAgentIntentHint(intentHintForWorkItem(item));
      setNotice("调整教练包已创建，正在等待确认。");
      startTransition(() => {
        router.push(appRoutes.chat);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法生成调整教练包。");
    } finally {
      setBusyAction(null);
    }
  }

  const todayPlan = workspace.todayPlan;
  const pendingPackage = workspace.pendingPackage;
  const latestQualityCheck = workspace.latestQualityChecks[0];

  return (
    <section className="coach-workspace-panel viz-wrap">
      <div className="section-copy coach-workspace-heading">
        <span className="section-label">Workspace</span>
        <h3>教练工作台</h3>
        <p className="muted">
          汇总需要继续处理的复盘、日志、记忆和教练包事项；所有训练、饮食和记忆变更仍需你确认后才会生效。
        </p>
      </div>

      <div className="coach-workspace-strip">
        <div>
          <span>今天</span>
          <strong>{todayPlan?.focus ?? "暂无今日计划"}</strong>
          <small>{todayPlan?.duration ?? "创建计划后会同步"}</small>
        </div>
        <div>
          <span>日志</span>
          <strong>{workspace.logGapSummary.needsCheckin || workspace.logGapSummary.needsWorkoutLog ? "需要更新" : "已同步"}</strong>
          <small>
            打卡 {workspace.logGapSummary.latestCheckinAt ? formatTime(workspace.logGapSummary.latestCheckinAt) : "待补"}
          </small>
        </div>
        <div>
          <span>教练包</span>
          <strong>{pendingPackage ? pendingPackage.status : "无待确认"}</strong>
          <small>{pendingPackage?.title ?? "暂无等待确认的教练包"}</small>
        </div>
        <div>
          <span>质量</span>
          <strong>{latestQualityCheck ? qualityDisplayLabel(latestQualityCheck.status) : "暂无检查"}</strong>
          <small>{latestQualityCheck ? `${latestQualityCheck.scope} ${qualityDisplayLabel(latestQualityCheck.status)}` : "复盘或教练包生成后会检查"}</small>
        </div>
      </div>

      <div className="action-row">
        <button type="button" className="button" onClick={() => void handleRefresh()} disabled={isRefreshing || busyAction !== null}>
          {isRefreshing ? "正在刷新..." : "刷新工作台"}
        </button>
      </div>

      {items.length > 0 ? (
        <div className="coach-work-item-list">
          {items.map((item) => (
            <article className={`coach-work-item priority-${item.priority}`} key={item.id}>
              <div className="coach-work-item-copy">
                <div className="evidence-tag-row">
                  <span className="evidence-tag">{typeLabels[item.type] ?? item.type}</span>
                  <span className="evidence-tag">{priorityLabels[item.priority] ?? item.priority}</span>
                  <span className="evidence-tag">{item.status}</span>
                </div>
                <strong>{item.title}</strong>
                <p className="muted">{item.summary}</p>
                <small>{item.reason} 截止 {formatTime(item.expiresAt)}</small>
              </div>
              <div className="coach-work-item-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void handleOpen(item)}
                  disabled={busyAction !== null || item.status === "expired"}
                >
                  {busyAction?.id === item.id && busyAction.action === "open" ? "正在打开..." : "打开"}
                </button>
                {item.type === "revision_suggested" ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void handleConvert(item)}
                    disabled={busyAction !== null || item.status === "expired"}
                  >
                    {busyAction?.id === item.id && busyAction.action === "convert" ? "正在生成..." : "生成调整"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ghost-button subtle"
                  onClick={() => void handleDismiss(item)}
                  disabled={busyAction !== null || item.status === "expired"}
                >
                  {busyAction?.id === item.id && busyAction.action === "dismiss" ? "正在关闭..." : "关闭"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="coach-workspace-empty">
          <strong>暂无待处理事项</strong>
          <small>刷新后，GymPal 会检查复盘时机、日志缺口、待确认教练包和效果追踪窗口。</small>
        </div>
      )}

      {notice ? <p className="dashboard-coaching-error neutral">{notice}</p> : null}
      {error ? <p className="dashboard-coaching-error">{error}</p> : null}
    </section>
  );
}
