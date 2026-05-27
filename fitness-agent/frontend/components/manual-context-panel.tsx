"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  createManualContext,
  deleteManualContext,
  listManualContexts,
  updateManualContext
} from "@/lib/api";
import type { ManualContextEntry, ManualContextPayload } from "@/lib/types";

type ManualContextPanelProps = {
  sourcePage: string;
  title: string;
  description: string;
  defaultCategory?: string;
  placeholder?: string;
};

type ManualDraft = {
  title: string;
  content: string;
  category: string;
  tagsText: string;
};

const emptyDraft: ManualDraft = {
  title: "",
  content: "",
  category: "manual_context",
  tagsText: ""
};

function parseTags(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function draftFromEntry(entry: ManualContextEntry): ManualDraft {
  return {
    title: entry.title,
    content: entry.content,
    category: entry.category,
    tagsText: entry.tags.join(", ")
  };
}

function buildPayload(sourcePage: string, draft: ManualDraft): ManualContextPayload {
  return {
    sourcePage,
    title: draft.title,
    content: draft.content,
    category: draft.category,
    tags: parseTags(draft.tagsText)
  };
}

export function ManualContextPanel({
  sourcePage,
  title,
  description,
  defaultCategory = "manual_context",
  placeholder = "例如：我周三晚上固定有空训练，肩膀推举时容易不舒服，希望智能教练安排计划时记住。"
}: ManualContextPanelProps) {
  const [items, setItems] = useState<ManualContextEntry[]>([]);
  const [draft, setDraft] = useState<ManualDraft>({ ...emptyDraft, category: defaultCategory });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<ManualDraft>(emptyDraft);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");

    void listManualContexts(sourcePage)
      .then((nextItems) => {
        if (!cancelled) {
          setItems(nextItems);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "无法读取手动信息。");
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
  }, [sourcePage]);

  const canCreate = useMemo(
    () => draft.title.trim().length > 0 && draft.content.trim().length > 0,
    [draft.content, draft.title]
  );

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate) {
      setError("标题和内容都需要填写。");
      return;
    }

    setPendingId("new");
    setError("");
    setMessage("");

    try {
      const created = await createManualContext(buildPayload(sourcePage, draft));
      setItems((current) => [created, ...current]);
      setDraft({ ...emptyDraft, category: defaultCategory });
      setMessage("已保存，智能教练下次回复会读取这条信息。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
    } finally {
      setPendingId(null);
    }
  }

  async function handleUpdate(entryId: string) {
    if (editingDraft.title.trim().length === 0 || editingDraft.content.trim().length === 0) {
      setError("标题和内容都需要填写。");
      return;
    }

    setPendingId(entryId);
    setError("");
    setMessage("");

    try {
      const updated = await updateManualContext(entryId, buildPayload(sourcePage, editingDraft));
      setItems((current) => current.map((item) => (item.id === entryId ? updated : item)));
      setEditingId(null);
      setMessage("已更新。");
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
      setMessage("已删除，智能教练不会继续读取这条信息。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败。");
    } finally {
      setPendingId(null);
    }
  }

  function beginEdit(entry: ManualContextEntry) {
    setEditingId(entry.id);
    setEditingDraft(draftFromEntry(entry));
    setError("");
    setMessage("");
  }

  return (
    <section className="manual-context-panel">
      <div className="manual-context-head">
        <div className="section-copy">
          <span className="section-label">智能教练上下文</span>
          <h3>{title}</h3>
          <p className="muted">{description}</p>
        </div>
        <span className="mini-chip">{isLoading ? "读取中" : `${items.length} 条`}</span>
      </div>

      <form className="manual-context-form" onSubmit={handleCreate}>
        <label className="field">
          <span className="form-label">标题</span>
          <input
            value={draft.title}
            placeholder="信息标题"
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
        <label className="field span-2">
          <span className="form-label">内容</span>
          <textarea
            value={draft.content}
            placeholder={placeholder}
            onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
          />
        </label>
        <div className="manual-context-inline">
          <label className="field">
            <span className="form-label">分类</span>
            <input
              value={draft.category}
              onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
            />
          </label>
          <label className="field">
            <span className="form-label">标签</span>
            <input
              value={draft.tagsText}
              placeholder="训练, 饮食, 时间"
              onChange={(event) => setDraft((current) => ({ ...current, tagsText: event.target.value }))}
            />
          </label>
          <button type="submit" className="button" disabled={pendingId !== null || !canCreate}>
            {pendingId === "new" ? "保存中..." : "添加"}
          </button>
        </div>
      </form>

      <div className="manual-context-list">
        {items.map((entry) => {
          const isEditing = editingId === entry.id;

          return (
            <article className="manual-context-item" key={entry.id}>
              {isEditing ? (
                <div className="manual-context-edit">
                  <label className="field">
                    <span className="form-label">标题</span>
                    <input
                      value={editingDraft.title}
                      onChange={(event) =>
                        setEditingDraft((current) => ({ ...current, title: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="form-label">内容</span>
                    <textarea
                      value={editingDraft.content}
                      onChange={(event) =>
                        setEditingDraft((current) => ({ ...current, content: event.target.value }))
                      }
                    />
                  </label>
                  <div className="manual-context-inline">
                    <label className="field">
                      <span className="form-label">分类</span>
                      <input
                        value={editingDraft.category}
                        onChange={(event) =>
                          setEditingDraft((current) => ({ ...current, category: event.target.value }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="form-label">标签</span>
                      <input
                        value={editingDraft.tagsText}
                        onChange={(event) =>
                          setEditingDraft((current) => ({ ...current, tagsText: event.target.value }))
                        }
                      />
                    </label>
                  </div>
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
                    <span className="section-label">{entry.category}</span>
                    <strong>{entry.title}</strong>
                    <p className="muted">{entry.content}</p>
                    {entry.tags.length > 0 ? <small>{entry.tags.join(" / ")}</small> : null}
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

        {!isLoading && items.length === 0 ? (
          <div className="manual-context-empty">
            <strong>还没有手动信息</strong>
            <p className="muted">添加后会写入数据库，并作为长期上下文提供给模型和智能教练。</p>
          </div>
        ) : null}
      </div>

      {message ? <p className="manual-context-status">{message}</p> : null}
      {error ? <p className="manual-context-error">{error}</p> : null}
    </section>
  );
}
