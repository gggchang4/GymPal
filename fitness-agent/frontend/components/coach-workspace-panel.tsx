"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { dismissAgentWorkItem, openAgentWorkItem, refreshAgentWorkItems } from "@/lib/api";
import { readAgentThreadId, writeAgentThreadId } from "@/lib/agent-thread";
import { appRoutes, type AppRoute } from "@/lib/routes";
import type { AgentWorkItemSnapshot, WorkspaceSummarySnapshot } from "@/lib/types";

const typeLabels: Record<string, string> = {
  weekly_review_due: "Weekly review",
  daily_guidance_due: "Daily guidance",
  log_gap: "Log gap",
  pending_package: "Pending package",
  memory_candidate: "Memory candidate",
  outcome_refresh_due: "Outcome refresh",
  revision_suggested: "Revision suggested"
};

const priorityLabels: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low"
};

function routeForNavigation(route: string): AppRoute {
  if (route === "logs") return appRoutes.logs;
  if (route === "plans") return appRoutes.planCurrent;
  if (route === "dashboard") return appRoutes.dashboard;
  return appRoutes.chat;
}

function formatTime(value?: string | null) {
  if (!value) {
    return "No deadline";
  }

  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function qualityDisplayLabel(status: string) {
  if (status === "blocked") return "needs more data";
  if (status === "downgraded") return "conservative version";
  if (status === "passed") return "ready to show";
  return "internal check";
}

export function CoachWorkspacePanel({ workspace }: { workspace: WorkspaceSummarySnapshot }) {
  const router = useRouter();
  const [items, setItems] = useState<AgentWorkItemSnapshot[]>(workspace.pendingWorkItems);
  const [busyId, setBusyId] = useState<string | null>(null);
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
      setNotice(`Created ${result.created.length}, updated ${result.updated.length}, skipped ${result.skipped.length}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to refresh workspace items.");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleOpen(item: AgentWorkItemSnapshot) {
    setBusyId(item.id);
    setError("");

    try {
      const result = await openAgentWorkItem(item.id);
      setItems((current) => current.map((entry) => (entry.id === item.id ? result.workItem : entry)));
      if (result.workItem.relatedThreadId) {
        writeAgentThreadId(result.workItem.relatedThreadId);
      } else if (!readAgentThreadId() && result.navigation.route === "chat") {
        setNotice("Open chat to continue this item with a new conversation.");
      }

      startTransition(() => {
        router.push(routeForNavigation(result.navigation.route));
      });
      setBusyId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open this item.");
      setBusyId(null);
    }
  }

  async function handleDismiss(item: AgentWorkItemSnapshot) {
    setBusyId(item.id);
    setError("");
    setNotice("");

    try {
      await dismissAgentWorkItem(item.id, "dismissed_from_dashboard");
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setNotice("Item dismissed. Similar prompts are cooled down for a while.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to dismiss this item.");
    } finally {
      setBusyId(null);
    }
  }

  const todayPlan = workspace.todayPlan;
  const pendingPackage = workspace.pendingPackage;
  const latestQualityCheck = workspace.latestQualityChecks[0];

  return (
    <section className="coach-workspace-panel viz-wrap">
      <div className="section-copy coach-workspace-heading">
        <span className="section-label">Phase 4</span>
        <h3>Coaching workspace</h3>
        <p className="muted">
          Active items are product reminders only. Training, diet, memory, and package changes still require explicit confirmation.
        </p>
      </div>

      <div className="coach-workspace-strip">
        <div>
          <span>Today</span>
          <strong>{todayPlan?.focus ?? "No active plan day"}</strong>
          <small>{todayPlan?.duration ?? "Refresh after creating a plan"}</small>
        </div>
        <div>
          <span>Logs</span>
          <strong>{workspace.logGapSummary.needsCheckin || workspace.logGapSummary.needsWorkoutLog ? "Needs update" : "Current"}</strong>
          <small>
            Check-in {workspace.logGapSummary.latestCheckinAt ? formatTime(workspace.logGapSummary.latestCheckinAt) : "missing"}
          </small>
        </div>
        <div>
          <span>Package</span>
          <strong>{pendingPackage ? pendingPackage.status : "None pending"}</strong>
          <small>{pendingPackage?.title ?? "No confirmation waiting"}</small>
        </div>
        <div>
          <span>Quality</span>
          <strong>{latestQualityCheck ? latestQualityCheck.status : "No checks yet"}</strong>
          <small>{latestQualityCheck ? `${latestQualityCheck.scope} ${qualityDisplayLabel(latestQualityCheck.status)}` : "Generated after reviews or packages"}</small>
        </div>
      </div>

      <div className="action-row">
        <button type="button" className="button" onClick={() => void handleRefresh()} disabled={isRefreshing || busyId !== null}>
          {isRefreshing ? "Refreshing..." : "Refresh workspace"}
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
                <small>{item.reason} Expires {formatTime(item.expiresAt)}</small>
              </div>
              <div className="coach-work-item-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void handleOpen(item)}
                  disabled={busyId !== null || item.status === "expired"}
                >
                  {busyId === item.id ? "Opening..." : "Open"}
                </button>
                <button
                  type="button"
                  className="ghost-button subtle"
                  onClick={() => void handleDismiss(item)}
                  disabled={busyId !== null || item.status === "expired"}
                >
                  Dismiss
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="coach-workspace-empty">
          <strong>No active workspace items</strong>
          <small>Refresh to let the agent check review timing, log gaps, pending packages, and outcome windows.</small>
        </div>
      )}

      {notice ? <p className="dashboard-coaching-error neutral">{notice}</p> : null}
      {error ? <p className="dashboard-coaching-error">{error}</p> : null}
    </section>
  );
}
