"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { appRoutes } from "@/lib/routes";
import { createThread, postMessage } from "@/lib/api";
import { readAgentThreadId, writeAgentThreadId } from "@/lib/agent-thread";
import type { CoachSummarySnapshot } from "@/lib/types";

const weeklyReviewPrompt = "帮我复盘这一周，并生成下周的训练、饮食和执行建议。";
const dailyGuidancePrompt = "根据我最近的恢复状态，给我一份今天的训练建议。";

function getOutcomeStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "观察中",
    positive: "效果积极",
    mixed: "效果混合",
    negative: "需要调整",
    inconclusive: "数据不足"
  };

  return labels[status] ?? status;
}

async function ensureAgentThread() {
  const currentThreadId = readAgentThreadId();
  if (currentThreadId) {
    return currentThreadId;
  }

  const created = await createThread();
  writeAgentThreadId(created.threadId);
  return created.threadId;
}

export function DashboardCoachingPanel({
  coachSummary
}: {
  coachSummary: CoachSummarySnapshot;
}) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<"weekly" | "daily" | "open" | null>(null);
  const [error, setError] = useState("");

  const pendingPackage = coachSummary.pendingCoachingPackage;
  const latestAdvice = coachSummary.recentAdviceSnapshots[0];
  const activeMemories = coachSummary.memorySummary.activeMemories.slice(0, 3);
  const latestOutcome = coachSummary.recentOutcomes[0];

  async function handleGenerate(prompt: string, action: "weekly" | "daily") {
    setBusyAction(action);
    setError("");

    try {
      const threadId = await ensureAgentThread();
      await postMessage(threadId, prompt);
      startTransition(() => {
        router.push(appRoutes.chat);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法创建教练建议，请稍后再试。");
      setBusyAction(null);
    }
  }

  function handleOpenPendingPackage() {
    setBusyAction("open");
    setError("");

    if (pendingPackage?.threadId) {
      writeAgentThreadId(pendingPackage.threadId);
    }

    startTransition(() => {
      router.push(appRoutes.chat);
    });
  }

  return (
    <section className="dashboard-coaching-panel">
      <div className="section-copy">
        <span className="section-label">Phase 2</span>
        <h3>闭环教练</h3>
        <p className="muted">
          现在可以从 dashboard 直接触发周复盘和今日建议，不需要先手动切到 chat 再输入固定 prompt。
        </p>
      </div>

      <div className="dashboard-coaching-status">
        <div className="dashboard-coaching-tile">
          <span>本周完成度</span>
          <strong>{coachSummary.completion.completionRate}%</strong>
          <small>
            已完成 {coachSummary.completion.completedDays} / {coachSummary.completion.totalDays || 0} 个训练日
          </small>
        </div>

        <div className="dashboard-coaching-tile">
          <span>复盘建议</span>
          <strong>{coachSummary.needsWeeklyReview ? "建议立即复盘" : "可按节奏复盘"}</strong>
          <small>
            {coachSummary.needsWeeklyReview
              ? "最近恢复或完成度有波动，适合生成下一周期的教练包。"
              : "当前执行相对稳定，也可以用复盘来提前整理下周节奏。"}
          </small>
        </div>
      </div>

      {pendingPackage ? (
        <div className="dashboard-pending-package">
          <div className="dashboard-pending-copy">
            <span className="section-label">待处理教练包</span>
            <strong>{pendingPackage.title}</strong>
            <p className="muted">{pendingPackage.summary}</p>
            <small>
              当前状态：{pendingPackage.status} · 创建时间：
              {new Date(pendingPackage.createdAt).toLocaleString("zh-CN")}
            </small>
          </div>

          <div className="action-row">
            <button
              type="button"
              className="ghost-button"
              onClick={handleOpenPendingPackage}
              disabled={busyAction !== null}
            >
              {busyAction === "open" ? "打开中..." : "继续处理"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="dashboard-coaching-note">
        <span className="section-label">教练记忆</span>
        <strong>
          {activeMemories.length > 0
            ? `已确认 ${coachSummary.memorySummary.activeMemories.length} 条长期偏好`
            : "还没有确认的长期偏好"}
        </strong>
        {activeMemories.length > 0 ? (
          <ul className="info-list">
            {activeMemories.map((memory) => (
              <li key={memory.id}>
                {memory.title}：{memory.summary}（置信度 {memory.confidence}%）
              </li>
            ))}
          </ul>
        ) : (
          <small>在 chat 里说“请记住……”，我会先生成待确认记忆，不会直接写入。</small>
        )}
      </div>

      <div className="dashboard-coaching-note">
        <span className="section-label">建议效果</span>
        <strong>{latestOutcome ? getOutcomeStatusLabel(latestOutcome.status) : "暂无可评估建议"}</strong>
        {latestOutcome ? (
          <small>
            {latestOutcome.summary}
            {typeof latestOutcome.score === "number" ? ` · 评分 ${latestOutcome.score}` : ""}
          </small>
        ) : (
          <small>执行教练包后，系统会跟踪后续训练、打卡和指标变化，再给出效果评估。</small>
        )}
      </div>

      <div className="action-row">
        <button
          type="button"
          className="button"
          onClick={() => void handleGenerate(weeklyReviewPrompt, "weekly")}
          disabled={busyAction !== null}
        >
          {busyAction === "weekly" ? "生成周复盘中..." : "开始本周复盘"}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => void handleGenerate(dailyGuidancePrompt, "daily")}
          disabled={busyAction !== null}
        >
          {busyAction === "daily" ? "生成今日建议中..." : "生成今日建议"}
        </button>
      </div>

      {latestAdvice ? (
        <div className="dashboard-coaching-note">
          <span className="section-label">最近一条建议</span>
          <strong>{latestAdvice.summary}</strong>
          <small>
            标签：{latestAdvice.reasoningTags.length > 0 ? latestAdvice.reasoningTags.join(" / ") : "暂无标签"}
          </small>
        </div>
      ) : null}

      {error ? <p className="dashboard-coaching-error">{error}</p> : null}
    </section>
  );
}
