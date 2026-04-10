"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkoutPlanDay } from "@/lib/types";

interface EditableWorkoutPlanDay extends WorkoutPlanDay {
  id: string;
}

interface PlanDraft {
  dayLabel: string;
  focus: string;
  duration: string;
  exercisesText: string;
  recoveryTip: string;
}

interface StoredPlanChecklistState {
  items: EditableWorkoutPlanDay[];
  completed: string[];
}

const planChecklistStorageKey = "health-agent.plan-checklist.v1";
const emptyDraft: PlanDraft = {
  dayLabel: "",
  focus: "",
  duration: "",
  exercisesText: "",
  recoveryTip: ""
};

function createPlanId() {
  return `plan-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function createEditablePlanItem(day: WorkoutPlanDay): EditableWorkoutPlanDay {
  return {
    ...day,
    id: createPlanId()
  };
}

function draftFromItem(day: WorkoutPlanDay): PlanDraft {
  return {
    dayLabel: day.dayLabel,
    focus: day.focus,
    duration: day.duration,
    exercisesText: day.exercises.join("\n"),
    recoveryTip: day.recoveryTip
  };
}

function parseExercises(exercisesText: string) {
  return exercisesText
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPlanFromDraft(draft: PlanDraft, id = createPlanId()): EditableWorkoutPlanDay {
  return {
    id,
    dayLabel: draft.dayLabel.trim() || "未命名",
    focus: draft.focus.trim() || "待补充计划",
    duration: draft.duration.trim() || "待安排",
    exercises: parseExercises(draft.exercisesText),
    recoveryTip: draft.recoveryTip.trim() || "暂无恢复提醒"
  };
}

function isStoredPlanItem(value: unknown): value is EditableWorkoutPlanDay {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;

  return (
    typeof item.id === "string" &&
    typeof item.dayLabel === "string" &&
    typeof item.focus === "string" &&
    typeof item.duration === "string" &&
    typeof item.recoveryTip === "string" &&
    Array.isArray(item.exercises) &&
    item.exercises.every((exercise) => typeof exercise === "string")
  );
}

export function PlanChecklist({ plan }: { plan: WorkoutPlanDay[] }) {
  const celebrationTimersRef = useRef<number[]>([]);
  const [items, setItems] = useState<EditableWorkoutPlanDay[]>(() => plan.map(createEditablePlanItem));
  const [completed, setCompleted] = useState<string[]>([]);
  const [celebrating, setCelebrating] = useState<string | null>(null);
  const [allCelebrating, setAllCelebrating] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [newDraft, setNewDraft] = useState<PlanDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<PlanDraft>(emptyDraft);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const progress = useMemo(
    () => Math.round((completed.length / Math.max(items.length, 1)) * 100),
    [completed.length, items.length]
  );

  const nextUp = items.find((day) => !completed.includes(day.id)) ?? null;
  const remainingCount = Math.max(items.length - completed.length, 0);

  useEffect(() => {
    return () => {
      celebrationTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      celebrationTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    try {
      const rawState = window.localStorage.getItem(planChecklistStorageKey);

      if (!rawState) {
        setStorageReady(true);
        return;
      }

      const parsed = JSON.parse(rawState) as Partial<StoredPlanChecklistState>;
      const storedItems = Array.isArray(parsed.items) ? parsed.items.filter(isStoredPlanItem) : [];
      const validIds = new Set(storedItems.map((item) => item.id));
      const storedCompleted = Array.isArray(parsed.completed)
        ? parsed.completed.filter((id): id is string => typeof id === "string" && validIds.has(id))
        : [];

      if (storedItems.length > 0) {
        setItems(storedItems);
        setCompleted(storedCompleted);
        setExpandedId(storedItems[0]?.id ?? null);
      }
    } catch {
      const nextItems = plan.map(createEditablePlanItem);
      setItems(nextItems);
      setCompleted([]);
      setExpandedId(nextItems[0]?.id ?? null);
    } finally {
      setStorageReady(true);
    }
  }, [plan]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    const validIds = new Set(items.map((item) => item.id));
    const syncedCompleted = completed.filter((id) => validIds.has(id));

    if (syncedCompleted.length !== completed.length) {
      setCompleted(syncedCompleted);
      return;
    }

    window.localStorage.setItem(
      planChecklistStorageKey,
      JSON.stringify({
        items,
        completed: syncedCompleted
      } satisfies StoredPlanChecklistState)
    );
  }, [completed, items, storageReady]);

  useEffect(() => {
    if (items.length === 0 || completed.length !== items.length) {
      setAllCelebrating(false);
      return;
    }

    setAllCelebrating(true);
    const timer = window.setTimeout(() => setAllCelebrating(false), 2200);
    return () => window.clearTimeout(timer);
  }, [completed.length, items.length]);

  function toggleComplete(itemId: string) {
    const isDone = completed.includes(itemId);

    if (isDone) {
      setCompleted((current) => current.filter((item) => item !== itemId));
      return;
    }

    setCompleted((current) => [...current, itemId]);
    setCelebrating(itemId);

    const timerId = window.setTimeout(() => {
      celebrationTimersRef.current = celebrationTimersRef.current.filter((value) => value !== timerId);
      setCelebrating((current) => (current === itemId ? null : current));
    }, 1200);

    celebrationTimersRef.current.push(timerId);
  }

  function handleAddItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextItem = buildPlanFromDraft(newDraft);
    setItems((current) => [...current, nextItem]);
    setExpandedId(nextItem.id);
    setComposerOpen(false);
    setNewDraft(emptyDraft);
  }

  function startEditing(item: EditableWorkoutPlanDay) {
    setEditingId(item.id);
    setEditingDraft(draftFromItem(item));
    setExpandedId(item.id);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingDraft(emptyDraft);
  }

  function handleSaveEdit(event: FormEvent<HTMLFormElement>, itemId: string) {
    event.preventDefault();
    const nextItem = buildPlanFromDraft(editingDraft, itemId);
    setItems((current) => current.map((item) => (item.id === itemId ? nextItem : item)));
    cancelEditing();
  }

  function handleDeleteItem(itemId: string) {
    const remainingItems = items.filter((item) => item.id !== itemId);
    setItems(remainingItems);
    setCompleted((current) => current.filter((item) => item !== itemId));

    if (editingId === itemId) {
      cancelEditing();
    }

    if (expandedId === itemId) {
      setExpandedId(remainingItems[0]?.id ?? null);
    }
  }

  return (
    <div className="dash-grid">
      <section className="todo-list refined">
        <div className="todo-list-top refined">
          <div className="section-copy">
            <span className="section-label">Todo</span>
            <h3>计划清单</h3>
          </div>

          <div className="todo-toolbar">
            <div className="chip-row">
              <span className="mini-chip">{items.length} 项</span>
              <span className="mini-chip">{completed.length} 已完成</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setComposerOpen((current) => !current)}>
              {composerOpen ? "收起新建" : "新建计划"}
            </button>
          </div>

          {composerOpen ? (
            <form className="todo-composer compact" onSubmit={handleAddItem}>
              <div className="form-grid two">
                <label className="field">
                  <span className="form-label">日期标签</span>
                  <input
                    value={newDraft.dayLabel}
                    onChange={(event) => setNewDraft((current) => ({ ...current, dayLabel: event.target.value }))}
                    placeholder="例如：周二"
                  />
                </label>
                <label className="field">
                  <span className="form-label">时长</span>
                  <input
                    value={newDraft.duration}
                    onChange={(event) => setNewDraft((current) => ({ ...current, duration: event.target.value }))}
                    placeholder="例如：50 分钟"
                  />
                </label>
                <label className="field span-2">
                  <span className="form-label">计划标题</span>
                  <input
                    value={newDraft.focus}
                    onChange={(event) => setNewDraft((current) => ({ ...current, focus: event.target.value }))}
                    placeholder="例如：低冲击下肢与步数补齐"
                  />
                </label>
                <label className="field span-2">
                  <span className="form-label">动作明细</span>
                  <textarea
                    value={newDraft.exercisesText}
                    onChange={(event) =>
                      setNewDraft((current) => ({ ...current, exercisesText: event.target.value }))
                    }
                    placeholder={"每行一个动作\n快走 35 分钟\n自重深蹲 3x15"}
                  />
                </label>
                <label className="field span-2">
                  <span className="form-label">恢复提醒</span>
                  <input
                    value={newDraft.recoveryTip}
                    onChange={(event) =>
                      setNewDraft((current) => ({ ...current, recoveryTip: event.target.value }))
                    }
                    placeholder="例如：训练后补水，并保证 7 小时以上睡眠"
                  />
                </label>
              </div>
              <div className="action-row">
                <button className="button" type="submit">
                  添加计划
                </button>
              </div>
            </form>
          ) : null}
        </div>

        {items.length === 0 ? (
          <div className="todo-empty">
            <strong>当前没有计划条目</strong>
            <p className="muted">可以先新建一项计划，清单会自动在这里展开。</p>
          </div>
        ) : null}

        {items.map((day) => {
          const isDone = completed.includes(day.id);
          const isCelebrating = celebrating === day.id;
          const isEditing = editingId === day.id;
          const isExpanded = expandedId === day.id || isEditing;

          return (
            <article
              className={`todo-item refined ${isDone ? "done" : ""} ${isEditing ? "is-editing" : ""} ${isExpanded ? "is-open" : ""}`}
              key={day.id}
            >
              <button
                type="button"
                className={`todo-check-button ${isDone ? "done" : ""}`}
                onClick={() => toggleComplete(day.id)}
                aria-label={`mark ${day.dayLabel} complete`}
              >
                <span className="todo-check" />
                {isCelebrating ? (
                  <span className="todo-confetti falling" aria-hidden="true">
                    {Array.from({ length: 12 }).map((_, index) => (
                      <span
                        key={index}
                        className="todo-confetti-piece falling"
                        style={
                          {
                            ["--piece-delay" as string]: `${index * 40}ms`,
                            ["--piece-left" as string]: `${8 + index * 7}%`,
                            ["--piece-rotate" as string]: `${index * 18}deg`
                          } as CSSProperties
                        }
                      />
                    ))}
                  </span>
                ) : null}
              </button>

              <button
                type="button"
                className="todo-main todo-toggle"
                onClick={() => setExpandedId((current) => (current === day.id ? null : day.id))}
                aria-expanded={isExpanded}
              >
                <div className="todo-main-head">
                  <span className="todo-meta">{day.dayLabel}</span>
                  <h3>{day.focus}</h3>
                </div>
                <p>{day.duration}</p>
              </button>

              <div className="todo-detail">
                <div className="todo-detail-inner">
                  {isEditing ? (
                    <form className="todo-inline-form" onSubmit={(event) => handleSaveEdit(event, day.id)}>
                      <div className="form-grid two">
                        <label className="field">
                          <span className="form-label">日期标签</span>
                          <input
                            value={editingDraft.dayLabel}
                            onChange={(event) =>
                              setEditingDraft((current) => ({ ...current, dayLabel: event.target.value }))
                            }
                          />
                        </label>
                        <label className="field">
                          <span className="form-label">时长</span>
                          <input
                            value={editingDraft.duration}
                            onChange={(event) =>
                              setEditingDraft((current) => ({ ...current, duration: event.target.value }))
                            }
                          />
                        </label>
                        <label className="field span-2">
                          <span className="form-label">计划标题</span>
                          <input
                            value={editingDraft.focus}
                            onChange={(event) =>
                              setEditingDraft((current) => ({ ...current, focus: event.target.value }))
                            }
                          />
                        </label>
                        <label className="field span-2">
                          <span className="form-label">动作明细</span>
                          <textarea
                            value={editingDraft.exercisesText}
                            onChange={(event) =>
                              setEditingDraft((current) => ({
                                ...current,
                                exercisesText: event.target.value
                              }))
                            }
                          />
                        </label>
                        <label className="field span-2">
                          <span className="form-label">恢复提醒</span>
                          <input
                            value={editingDraft.recoveryTip}
                            onChange={(event) =>
                              setEditingDraft((current) => ({
                                ...current,
                                recoveryTip: event.target.value
                              }))
                            }
                          />
                        </label>
                      </div>
                      <div className="action-row">
                        <button className="button" type="submit">
                          保存修改
                        </button>
                        <button className="ghost-button" type="button" onClick={cancelEditing}>
                          取消
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="todo-detail-grid">
                        <div className="todo-exercise-list">
                          {day.exercises.length > 0 ? (
                            day.exercises.map((exercise) => (
                              <span className="todo-exercise-chip" key={exercise}>
                                {exercise}
                              </span>
                            ))
                          ) : (
                            <span className="todo-exercise-chip">暂无动作明细</span>
                          )}
                        </div>
                        <span className="todo-note">{day.recoveryTip}</span>
                      </div>
                      <div className="todo-item-tools">
                        <button className="chip-button" type="button" onClick={() => startEditing(day)}>
                          编辑
                        </button>
                        <button
                          className="ghost-button todo-danger-button"
                          type="button"
                          onClick={() => handleDeleteItem(day.id)}
                        >
                          删除
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <aside className="plan-quick-panel refined">
        <div className={`plan-progress-panel refined ${allCelebrating ? "complete" : ""}`}>
          {allCelebrating ? (
            <span className="plan-complete-rain" aria-hidden="true">
              {Array.from({ length: 28 }).map((_, index) => (
                <span
                  key={index}
                  className="plan-complete-piece"
                  style={
                    {
                      ["--rain-left" as string]: `${(index % 14) * 7 + 2}%`,
                      ["--rain-delay" as string]: `${(index % 7) * 90}ms`,
                      ["--rain-rotate" as string]: `${index * 17}deg`
                    } as CSSProperties
                  }
                />
              ))}
            </span>
          ) : null}

          <div className="plan-progress-kicker">
            <span className="section-label">Progress</span>
            <span className="mini-chip">
              {completed.length}/{items.length}
            </span>
          </div>

          <div className="plan-progress-head">
            <strong>{progress}%</strong>
            <p className="muted">
              {progress === 100 ? "本周计划已全部完成。" : `还剩 ${remainingCount} 项待完成。`}
            </p>
          </div>

          <div className="plan-progress-ring" aria-hidden="true">
            <span className="plan-progress-ring-track" />
            <span
              className="plan-progress-ring-fill"
              style={{ ["--progress" as string]: `${progress}` } as CSSProperties}
            />
            <div className="plan-progress-ring-center">
              <strong>{completed.length}</strong>
              <small>done</small>
            </div>
          </div>

          <div className="plan-progress-rail" aria-hidden="true">
            {items.map((day) => (
              <span
                key={day.id}
                className={`plan-progress-step ${completed.includes(day.id) ? "done" : ""}`}
              />
            ))}
          </div>

          <div className="plan-side-list compact">
            <div className="plan-side-row compact">
              <span className="metric-label">Next</span>
              <strong>{nextUp?.focus ?? "本周清单已清空"}</strong>
              <small>{nextUp?.duration ?? "可以新增下一项计划，继续保持节奏。"}</small>
            </div>
            <div className="plan-side-row compact">
              <span className="metric-label">Rhythm</span>
              <strong>{completed.length >= 2 ? "执行节奏稳定" : "先建立连续性"}</strong>
              <small>先完成最容易稳定执行的项目，优先保证恢复和频率。</small>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
