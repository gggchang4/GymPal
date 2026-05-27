"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { ActivityRings, type ActivityRingItem } from "@/components/activity-rings";
import {
  createManualContext,
  deleteManualContext,
  listManualContexts,
  updateManualContext
} from "@/lib/api";
import type { ManualContextEntry, ManualContextPayload } from "@/lib/types";

type RingDraft = {
  slug: string;
  label: string;
  value: string;
  note: string;
  accent: string;
};

const sourcePage = "dashboard_activity";
const category = "dashboard_activity_metric";
const emptyDraft: RingDraft = {
  slug: "",
  label: "",
  value: "0",
  note: "",
  accent: "#d53832"
};

function clampPercent(value: string | number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || `metric-${Date.now()}`;
}

function valueAsRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function ringFromEntry(entry: ManualContextEntry): ActivityRingItem {
  const value = valueAsRecord(entry.value);

  return {
    slug: typeof value.slug === "string" ? value.slug : slugify(entry.title),
    label: typeof value.label === "string" ? value.label : entry.title,
    value: clampPercent(typeof value.value === "number" || typeof value.value === "string" ? value.value : 0),
    note: typeof value.note === "string" ? value.note : entry.content,
    accent: typeof value.accent === "string" ? value.accent : "#d53832"
  };
}

function draftFromRing(ring: ActivityRingItem): RingDraft {
  return {
    slug: ring.slug,
    label: ring.label,
    value: String(ring.value),
    note: ring.note,
    accent: ring.accent
  };
}

function buildPayload(draft: RingDraft): ManualContextPayload {
  const label = draft.label.trim();
  const slug = draft.slug.trim() || slugify(label);
  const value = clampPercent(draft.value);
  const note = draft.note.trim();

  return {
    sourcePage,
    title: label,
    content: `${label}：${note}（${value}%）`,
    category,
    tags: ["dashboard", "activity_ring", slug],
    value: {
      slug,
      label,
      value,
      note,
      accent: draft.accent.trim() || "#d53832"
    }
  };
}

export function DashboardActivityRings({ fallbackRings = [] }: { fallbackRings?: ActivityRingItem[] }) {
  const [items, setItems] = useState<ManualContextEntry[]>([]);
  const [draft, setDraft] = useState<RingDraft>({ ...emptyDraft, slug: "custom" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<RingDraft>(emptyDraft);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    void listManualContexts(sourcePage)
      .then((nextItems) => {
        if (!cancelled) {
          setItems(nextItems);
        }
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

  const manualRings = useMemo(() => items.map(ringFromEntry).slice(0, 3), [items]);
  const visibleRings = manualRings.length > 0 ? manualRings : fallbackRings;
  const canCreate = draft.label.trim().length > 0 && draft.note.trim().length > 0;

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate) {
      setError("指标名称和说明都需要填写。");
      return;
    }

    setPendingId("new");
    setError("");
    setMessage("");

    try {
      const created = await createManualContext(buildPayload(draft));
      setItems((current) => [created, ...current]);
      setDraft({ ...emptyDraft, slug: "custom" });
      setMessage("活动指标已保存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
    } finally {
      setPendingId(null);
    }
  }

  async function handleUpdate(entryId: string) {
    if (editingDraft.label.trim().length === 0 || editingDraft.note.trim().length === 0) {
      setError("指标名称和说明都需要填写。");
      return;
    }

    setPendingId(entryId);
    setError("");
    setMessage("");

    try {
      const updated = await updateManualContext(entryId, buildPayload(editingDraft));
      setItems((current) => current.map((item) => (item.id === entryId ? updated : item)));
      setEditingId(null);
      setMessage("活动指标已更新。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新失败。");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(entryId: string) {
    setPendingId(entryId);
    setError("");
    setMessage("");

    try {
      await deleteManualContext(entryId);
      setItems((current) => current.filter((item) => item.id !== entryId));
      setMessage("活动指标已删除。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败。");
    } finally {
      setPendingId(null);
    }
  }

  function beginEdit(entry: ManualContextEntry) {
    setEditingId(entry.id);
    setEditingDraft(draftFromRing(ringFromEntry(entry)));
    setMessage("");
    setError("");
  }

  function copyFallback(ring: ActivityRingItem) {
    setDraft(draftFromRing(ring));
    setMessage("已复制默认指标，可以修改后保存。");
    setError("");
  }

  return (
    <section className="dashboard-activity-manager">
      {visibleRings.length > 0 ? (
        <ActivityRings rings={visibleRings} />
      ) : (
        <section className="fitness-ring-panel activity-rings-widget">
          <div className="section-copy">
            <span className="section-label">活动</span>
            <h3>暂无活动指标</h3>
            <p className="muted">请在下方手动添加消耗、负荷、专注等指标。</p>
          </div>
        </section>
      )}

      <details className="dashboard-metric-editor">
        <summary className="dashboard-editor-summary">管理活动指标</summary>

        <div className="manual-context-head">
          <div className="section-copy">
            <span className="section-label">活动指标</span>
            <h3>手动维护活动指标</h3>
            <p className="muted">这里控制上方的消耗、负荷、专注等活动环。保存后写入数据库，并作为智能教练可读取的上下文。</p>
          </div>
          <span className="mini-chip">{isLoading ? "读取中" : `${items.length} 条手动指标`}</span>
        </div>

        <form className="dashboard-metric-form" onSubmit={handleCreate}>
          <label className="field">
            <span className="form-label">指标标识</span>
            <input
              value={draft.slug}
              placeholder="消耗"
              onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))}
            />
          </label>
          <label className="field">
            <span className="form-label">名称</span>
            <input
              value={draft.label}
              placeholder="消耗"
              onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
            />
          </label>
          <label className="field">
            <span className="form-label">百分比</span>
            <input
              type="number"
              min={0}
              max={100}
              value={draft.value}
              onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
            />
          </label>
          <label className="field">
            <span className="form-label">颜色</span>
            <input
              type="color"
              value={draft.accent}
              onChange={(event) => setDraft((current) => ({ ...current, accent: event.target.value }))}
            />
          </label>
          <label className="field span-2">
            <span className="form-label">说明</span>
            <input
              value={draft.note}
              placeholder="今日已消耗 612 千卡"
              onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
            />
          </label>
          <button type="submit" className="button" disabled={pendingId !== null || !canCreate}>
            {pendingId === "new" ? "保存中..." : "新增指标"}
          </button>
        </form>

        {items.length === 0 ? (
          <div className="dashboard-default-metrics">
            {fallbackRings.map((ring) => (
              <button type="button" className="ghost-button" key={ring.slug} onClick={() => copyFallback(ring)}>
                复制默认：{ring.label} {ring.value}%
              </button>
            ))}
          </div>
        ) : null}

        <div className="manual-context-list">
          {items.map((entry) => {
            const isEditing = editingId === entry.id;
            const ring = ringFromEntry(entry);

            return (
              <article className="manual-context-item" key={entry.id}>
                {isEditing ? (
                  <div className="dashboard-metric-form compact">
                    <label className="field">
                      <span className="form-label">指标标识</span>
                      <input
                        value={editingDraft.slug}
                        onChange={(event) =>
                          setEditingDraft((current) => ({ ...current, slug: event.target.value }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="form-label">名称</span>
                      <input
                        value={editingDraft.label}
                        onChange={(event) =>
                          setEditingDraft((current) => ({ ...current, label: event.target.value }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="form-label">百分比</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={editingDraft.value}
                        onChange={(event) =>
                          setEditingDraft((current) => ({ ...current, value: event.target.value }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="form-label">颜色</span>
                      <input
                        type="color"
                        value={editingDraft.accent}
                        onChange={(event) =>
                          setEditingDraft((current) => ({ ...current, accent: event.target.value }))
                        }
                      />
                    </label>
                    <label className="field span-2">
                      <span className="form-label">说明</span>
                      <input
                        value={editingDraft.note}
                        onChange={(event) =>
                          setEditingDraft((current) => ({ ...current, note: event.target.value }))
                        }
                      />
                    </label>
                    <div className="action-row">
                      <button
                        type="button"
                        className="button"
                        disabled={pendingId !== null}
                        onClick={() => void handleUpdate(entry.id)}
                      >
                        {pendingId === entry.id ? "保存中..." : "保存"}
                      </button>
                      <button type="button" className="ghost-button" onClick={() => setEditingId(null)}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="manual-context-item-copy">
                      <span className="section-label">{ring.slug}</span>
                      <strong>
                        {ring.label} {ring.value}%
                      </strong>
                      <p className="muted">{ring.note}</p>
                    </div>
                    <div className="action-row">
                      <button type="button" className="ghost-button" onClick={() => beginEdit(entry)}>
                        编辑
                      </button>
                      <button
                        type="button"
                        className="ghost-button danger"
                        disabled={pendingId !== null}
                        onClick={() => void handleDelete(entry.id)}
                      >
                        {pendingId === entry.id ? "删除中..." : "删除"}
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>

        {message ? <p className="manual-context-status">{message}</p> : null}
        {error ? <p className="manual-context-error">{error}</p> : null}
      </details>
    </section>
  );
}
