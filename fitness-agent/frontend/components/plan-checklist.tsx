"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  createCurrentPlanDay,
  deleteCurrentPlanDay,
  getCurrentPlan,
  updateCurrentPlanDay
} from "@/lib/api";
import type { WorkoutPlanDay } from "@/lib/types";

interface PlanDraft {
  dayLabel: string;
  focus: string;
  duration: string;
  exercisesText: string;
  recoveryTip: string;
}

const emptyDraft: PlanDraft = {
  dayLabel: "",
  focus: "",
  duration: "",
  exercisesText: "",
  recoveryTip: ""
};

function sortPlanItems(items: WorkoutPlanDay[]) {
  return [...items].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.dayLabel.localeCompare(right.dayLabel, "zh-CN")
  );
}

function parseExercises(exercisesText: string) {
  return exercisesText
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
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

function normalizeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "保存失败，请稍后重试。";

  if (raw.includes("Workout plan day was not found")) {
    return "这条计划已经不存在了，请刷新页面后重试。";
  }

  return raw;
}

function getNextExpandedId(items: WorkoutPlanDay[], removedId: string) {
  const remaining = items.filter((item) => item.id !== removedId);
  return remaining[0]?.id ?? null;
}

export function PlanChecklist({ plan }: { plan: WorkoutPlanDay[] }) {
  const [items, setItems] = useState<WorkoutPlanDay[]>(() => sortPlanItems(plan));
  const [composerOpen, setComposerOpen] = useState(plan.length === 0);
  const [newDraft, setNewDraft] = useState<PlanDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<PlanDraft>(emptyDraft);
  const [expandedId, setExpandedId] = useState<string | null>(plan[0]?.id ?? null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSyncingPlan, setIsSyncingPlan] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const nextItems = sortPlanItems(plan);
    setItems(nextItems);
    setExpandedId((current) => (nextItems.some((item) => item.id === current) ? current : nextItems[0]?.id ?? null));
  }, [plan]);

  useEffect(() => {
    let cancelled = false;
    setIsSyncingPlan(true);

    void getCurrentPlan()
      .then((nextPlan) => {
        if (cancelled) {
          return;
        }

        const nextItems = sortPlanItems(nextPlan);
        setItems(nextItems);
        setComposerOpen(nextItems.length === 0);
        setExpandedId((current) => (nextItems.some((item) => item.id === current) ? current : nextItems[0]?.id ?? null));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setErrorMessage(normalizeErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) {
          setIsSyncingPlan(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const completedCount = useMemo(() => items.filter((item) => item.isCompleted).length, [items]);
  const progress = useMemo(
    () => Math.round((completedCount / Math.max(items.length, 1)) * 100),
    [completedCount, items.length]
  );
  const nextUp = items.find((item) => !item.isCompleted) ?? null;
  const remainingCount = Math.max(items.length - completedCount, 0);

  function clearMessages() {
    setFeedbackMessage("");
    setErrorMessage("");
  }

  function startEditing(item: WorkoutPlanDay) {
    clearMessages();
    setEditingId(item.id);
    setEditingDraft(draftFromItem(item));
    setExpandedId(item.id);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingDraft(emptyDraft);
  }

  async function handleAddItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    setIsCreating(true);
    const isFirstItem = items.length === 0;

    try {
      const created = await createCurrentPlanDay({
        dayLabel: newDraft.dayLabel,
        focus: newDraft.focus,
        duration: newDraft.duration,
        exercises: parseExercises(newDraft.exercisesText),
        recoveryTip: newDraft.recoveryTip
      });

      setItems((current) => sortPlanItems([...current, created]));
      setExpandedId(created.id);
      setComposerOpen(false);
      setNewDraft(emptyDraft);
      setFeedbackMessage(isFirstItem ? "已创建第一条待办，并同步到数据库。" : "计划项已新增。");
    } catch (error) {
      setErrorMessage(normalizeErrorMessage(error));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>, itemId: string) {
    event.preventDefault();
    clearMessages();
    setPendingItemId(itemId);

    try {
      const updated = await updateCurrentPlanDay(itemId, {
        dayLabel: editingDraft.dayLabel,
        focus: editingDraft.focus,
        duration: editingDraft.duration,
        exercises: parseExercises(editingDraft.exercisesText),
        recoveryTip: editingDraft.recoveryTip
      });

      setItems((current) => sortPlanItems(current.map((item) => (item.id === itemId ? updated : item))));
      cancelEditing();
      setExpandedId(itemId);
      setFeedbackMessage("计划项已更新。");
    } catch (error) {
      setErrorMessage(normalizeErrorMessage(error));
    } finally {
      setPendingItemId(null);
    }
  }

  async function handleDeleteItem(itemId: string) {
    clearMessages();
    setPendingItemId(itemId);

    try {
      await deleteCurrentPlanDay(itemId);
      const nextExpandedId = getNextExpandedId(items, itemId);

      setItems((current) => current.filter((item) => item.id !== itemId));
      setExpandedId((current) => (current === itemId ? nextExpandedId : current));

      if (editingId === itemId) {
        cancelEditing();
      }

      setFeedbackMessage("计划项已删除。");
    } catch (error) {
      setErrorMessage(normalizeErrorMessage(error));
    } finally {
      setPendingItemId(null);
    }
  }

  async function handleToggleComplete(item: WorkoutPlanDay) {
    clearMessages();
    setPendingItemId(item.id);

    const previousItems = items;
    const optimisticItems = items.map((current) =>
      current.id === item.id ? { ...current, isCompleted: !current.isCompleted } : current
    );
    setItems(optimisticItems);

    try {
      const updated = await updateCurrentPlanDay(item.id, {
        isCompleted: !item.isCompleted
      });

      setItems((current) => current.map((planItem) => (planItem.id === item.id ? updated : planItem)));
      setFeedbackMessage(updated.isCompleted ? "已标记完成。" : "已取消完成标记。");
    } catch (error) {
      setItems(previousItems);
      setErrorMessage(normalizeErrorMessage(error));
    } finally {
      setPendingItemId(null);
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
              <span className="mini-chip">{completedCount} 已完成</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setComposerOpen((current) => !current)}>
              {composerOpen ? "收起新建" : "新建计划"}
            </button>
          </div>

          {feedbackMessage ? <p className="field-hint">{feedbackMessage}</p> : null}
          {errorMessage ? <p className="field-hint" style={{ color: "#8c1e1a" }}>{errorMessage}</p> : null}
          {isSyncingPlan ? <p className="field-hint">正在同步当前账号的待办列表…</p> : null}

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
                    placeholder="例如：40 分钟"
                  />
                </label>

                <label className="field span-2">
                  <span className="form-label">计划标题</span>
                  <input
                    value={newDraft.focus}
                    onChange={(event) => setNewDraft((current) => ({ ...current, focus: event.target.value }))}
                    placeholder="例如：低冲击下肢训练与步数补齐"
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
                <button className="button" type="submit" disabled={isCreating}>
                  {isCreating ? "保存中..." : items.length === 0 ? "创建第一条待办" : "添加计划"}
                </button>
              </div>
            </form>
          ) : null}
        </div>

        {items.length === 0 ? (
          <div className="todo-empty">
            <strong>当前还没有计划条目</strong>
            <p className="muted">
              现在可以直接新建第一条待办。系统会在后台自动准备一个当前可编辑计划，再把这条 Todo 写入数据库。
            </p>
          </div>
        ) : null}

        {items.map((day) => {
          const isEditing = editingId === day.id;
          const isExpanded = expandedId === day.id || isEditing;
          const isBusy = pendingItemId === day.id;

          return (
            <article
              className={`todo-item refined ${day.isCompleted ? "done" : ""} ${isEditing ? "is-editing" : ""} ${isExpanded ? "is-open" : ""}`}
              key={day.id}
            >
              <button
                type="button"
                className={`todo-check-button ${day.isCompleted ? "done" : ""}`}
                onClick={() => handleToggleComplete(day)}
                aria-label={`切换 ${day.dayLabel} 的完成状态`}
                disabled={isBusy}
              >
                <span className="todo-check" />
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
                              setEditingDraft((current) => ({ ...current, exercisesText: event.target.value }))
                            }
                          />
                        </label>

                        <label className="field span-2">
                          <span className="form-label">恢复提醒</span>
                          <input
                            value={editingDraft.recoveryTip}
                            onChange={(event) =>
                              setEditingDraft((current) => ({ ...current, recoveryTip: event.target.value }))
                            }
                          />
                        </label>
                      </div>

                      <div className="action-row">
                        <button className="button" type="submit" disabled={isBusy}>
                          {isBusy ? "保存中..." : "保存修改"}
                        </button>
                        <button className="ghost-button" type="button" onClick={cancelEditing} disabled={isBusy}>
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
                        <button className="chip-button" type="button" onClick={() => startEditing(day)} disabled={isBusy}>
                          编辑
                        </button>
                        <button
                          className="ghost-button todo-danger-button"
                          type="button"
                          onClick={() => handleDeleteItem(day.id)}
                          disabled={isBusy}
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
        <div className={`plan-progress-panel refined ${items.length > 0 && progress === 100 ? "complete" : ""}`}>
          <div className="plan-progress-kicker">
            <span className="section-label">Progress</span>
            <span className="mini-chip">
              {completedCount}/{items.length}
            </span>
          </div>

          <div className="plan-progress-head">
            <strong>{progress}%</strong>
            <p className="muted">
              {items.length === 0
                ? "当前还没有可以执行的计划项。"
                : progress === 100
                  ? "本周计划已经全部完成。"
                  : `还剩 ${remainingCount} 项待完成。`}
            </p>
          </div>

          <div className="plan-progress-ring" aria-hidden="true">
            <span className="plan-progress-ring-track" />
            <span
              className="plan-progress-ring-fill"
              style={{ ["--progress" as string]: `${progress}` }}
            />
            <div className="plan-progress-ring-center">
              <strong>{completedCount}</strong>
              <small>已完成</small>
            </div>
          </div>

          <div className="plan-progress-rail" aria-hidden="true">
            {items.map((day) => (
              <span key={day.id} className={`plan-progress-step ${day.isCompleted ? "done" : ""}`} />
            ))}
          </div>

          <div className="plan-side-list compact">
            <div className="plan-side-row compact">
              <span className="metric-label">下一项</span>
              <strong>{nextUp?.focus ?? "本周清单已全部完成"}</strong>
              <small>{nextUp?.duration ?? "你可以继续新增下一条计划，保持稳定节奏。"}</small>
            </div>

            <div className="plan-side-row compact">
              <span className="metric-label">节奏</span>
              <strong>{completedCount >= 2 ? "执行节奏较稳定" : "先建立连续性"}</strong>
              <small>优先把最容易稳定执行的项目做完，再逐步增加训练量。</small>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
