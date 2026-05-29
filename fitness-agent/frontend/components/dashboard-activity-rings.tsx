"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { ActivityRings, type ActivityRingItem } from "@/components/activity-rings";
import { createManualContext, listManualContexts, updateManualContext } from "@/lib/api";
import type { ManualContextEntry, ManualContextPayload } from "@/lib/types";

type ActivityMetricKey = "steps" | "workoutMinutes" | "activeHours";

type ActivityValues = Record<ActivityMetricKey, number>;

type ActivityEntryKind = "targets" | "completed";

const sourcePage = "dashboard_activity";
const category = "dashboard_activity_metric";

const defaultTargets: ActivityValues = {
  steps: 10000,
  workoutMinutes: 45,
  activeHours: 12
};

const defaultCompleted: ActivityValues = {
  steps: 0,
  workoutMinutes: 0,
  activeHours: 0
};

const metricConfig: Array<{
  key: ActivityMetricKey;
  label: string;
  unit: string;
  accent: string;
}> = [
  { key: "steps", label: "今日步数", unit: "步", accent: "#d53832" },
  { key: "workoutMinutes", label: "锻炼时长", unit: "分钟", accent: "#f0a22e" },
  { key: "activeHours", label: "活动小时数", unit: "小时", accent: "#1f8f5f" }
];

function valueAsRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toPositiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function readActivityValues(entry: ManualContextEntry | undefined, fallback: ActivityValues): ActivityValues {
  const value = valueAsRecord(entry?.value);

  return {
    steps: toPositiveNumber(value.steps, fallback.steps),
    workoutMinutes: toPositiveNumber(value.workoutMinutes, fallback.workoutMinutes),
    activeHours: toPositiveNumber(value.activeHours, fallback.activeHours)
  };
}

function findActivityEntry(items: ManualContextEntry[], kind: ActivityEntryKind) {
  return items.find((item) => {
    const value = valueAsRecord(item.value);
    return value.kind === kind && value.schema === "fixed_activity_rings";
  });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: value % 1 === 0 ? 0 : 1 }).format(value);
}

function percentOf(completed: number, target: number) {
  if (!Number.isFinite(target) || target <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((completed / target) * 100)));
}

function buildPayload(kind: ActivityEntryKind, values: ActivityValues): ManualContextPayload {
  const title = kind === "targets" ? "活动目标值" : "今日活动完成值";
  const content =
    kind === "targets"
      ? `今日目标：${formatNumber(values.steps)} 步，锻炼 ${formatNumber(values.workoutMinutes)} 分钟，活动 ${formatNumber(values.activeHours)} 小时。`
      : `今日完成：${formatNumber(values.steps)} 步，锻炼 ${formatNumber(values.workoutMinutes)} 分钟，活动 ${formatNumber(values.activeHours)} 小时。`;

  return {
    sourcePage,
    title,
    content,
    category,
    tags: ["dashboard", "activity_ring", kind],
    value: {
      schema: "fixed_activity_rings",
      kind,
      ...values
    }
  };
}

export function DashboardActivityRings() {
  const [items, setItems] = useState<ManualContextEntry[]>([]);
  const [targets, setTargets] = useState<ActivityValues>(defaultTargets);
  const [completed, setCompleted] = useState<ActivityValues>(defaultCompleted);
  const [targetDraft, setTargetDraft] = useState<ActivityValues>(defaultTargets);
  const [completedDraft, setCompletedDraft] = useState<ActivityValues>(defaultCompleted);
  const [activeModal, setActiveModal] = useState<ActivityEntryKind | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingKind, setPendingKind] = useState<ActivityEntryKind | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    void listManualContexts(sourcePage)
      .then((nextItems) => {
        if (cancelled) {
          return;
        }

        const targetValues = readActivityValues(findActivityEntry(nextItems, "targets"), defaultTargets);
        const completedValues = readActivityValues(findActivityEntry(nextItems, "completed"), defaultCompleted);

        setItems(nextItems);
        setTargets(targetValues);
        setCompleted(completedValues);
        setTargetDraft(targetValues);
        setCompletedDraft(completedValues);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "无法读取活动指标。");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const rings = useMemo<ActivityRingItem[]>(
    () =>
      metricConfig.map((metric) => {
        const current = completed[metric.key];
        const target = targets[metric.key];

        return {
          slug: metric.key,
          label: metric.label,
          value: percentOf(current, target),
          note: `${formatNumber(current)} / ${formatNumber(target)} ${metric.unit}`,
          accent: metric.accent
        };
      }),
    [completed, targets]
  );

  const averagePercent = Math.round(rings.reduce((total, ring) => total + ring.value, 0) / rings.length);

  function openModal(kind: ActivityEntryKind) {
    setTargetDraft(targets);
    setCompletedDraft(completed);
    setActiveModal(kind);
    setError("");
    setMessage("");
  }

  async function saveValues(kind: ActivityEntryKind, nextValues: ActivityValues) {
    setPendingKind(kind);
    setError("");
    setMessage("");

    try {
      const existing = findActivityEntry(items, kind);
      const payload = buildPayload(kind, nextValues);
      const saved = existing
        ? await updateManualContext(existing.id, payload)
        : await createManualContext(payload);

      setItems((current) => {
        if (existing) {
          return current.map((item) => (item.id === existing.id ? saved : item));
        }

        return [saved, ...current];
      });

      if (kind === "targets") {
        setTargets(nextValues);
      } else {
        setCompleted(nextValues);
      }

      setActiveModal(null);
      setMessage(kind === "targets" ? "目标值已保存。" : "今日完成值已保存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
    } finally {
      setPendingKind(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (activeModal === "targets") {
      void saveValues("targets", targetDraft);
    } else if (activeModal === "completed") {
      void saveValues("completed", completedDraft);
    }
  }

  const modalDraft = activeModal === "targets" ? targetDraft : completedDraft;
  const setModalDraft = activeModal === "targets" ? setTargetDraft : setCompletedDraft;

  return (
    <section className="dashboard-activity-manager">
      <ActivityRings rings={rings} />

      <div className="dashboard-activity-actions">
        <div className="section-copy">
          <span className="section-label">活动指标</span>
          <h3>今日活动完成度</h3>
          <p className="muted">
            外环为今日步数，中环为锻炼时长，内环为活动小时数。系统会按今日完成值 / 目标值计算百分比。
          </p>
        </div>
        <span className="mini-chip">{isLoading ? "读取中" : `平均完成 ${averagePercent}%`}</span>
        <div className="action-row">
          <button type="button" className="ghost-button" onClick={() => openModal("targets")}>
            设置目标量
          </button>
          <button type="button" className="button" onClick={() => openModal("completed")}>
            填写今日完成
          </button>
        </div>
      </div>

      {message ? <p className="manual-context-status">{message}</p> : null}
      {error ? <p className="manual-context-error">{error}</p> : null}

      {activeModal ? (
        <div className="activity-modal-overlay" role="presentation" onClick={() => setActiveModal(null)}>
          <form
            className="activity-modal"
            onSubmit={handleSubmit}
            role="dialog"
            aria-modal="true"
            aria-labelledby="activity-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="manual-context-head">
              <div className="section-copy">
                <span className="section-label">活动指标</span>
                <h3 id="activity-modal-title">
                  {activeModal === "targets" ? "设置三个目标量" : "填写今日完成值"}
                </h3>
              </div>
              <button type="button" className="diet-icon-button" onClick={() => setActiveModal(null)} aria-label="关闭">
                ×
              </button>
            </div>

            <div className="dashboard-fixed-metric-form">
              {metricConfig.map((metric) => (
                <label className="field" key={metric.key}>
                  <span className="form-label">
                    {metric.label}（{metric.unit}）
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={modalDraft[metric.key]}
                    onChange={(event) =>
                      setModalDraft((current) => ({
                        ...current,
                        [metric.key]: toPositiveNumber(event.target.value, 0)
                      }))
                    }
                  />
                </label>
              ))}
            </div>

            <div className="action-row">
              <button type="submit" className="button" disabled={pendingKind !== null}>
                {pendingKind === activeModal ? "保存中..." : "保存"}
              </button>
              <button type="button" className="ghost-button" onClick={() => setActiveModal(null)}>
                取消
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
