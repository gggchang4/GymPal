"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { DietPlateCard } from "@/components/diet-plate-card";
import {
  createManualContext,
  deleteManualContext,
  listManualContexts,
  updateManualContext
} from "@/lib/api";
import type {
  DietFood,
  DietMeal,
  DietMealType,
  DietRecommendationSnapshot,
  ManualContextEntry,
  ManualContextPayload
} from "@/lib/types";

type MacroType = "carbohydrate" | "protein" | "fat";

type FoodDraft = {
  name: string;
  mealType: DietMealType;
  macroType: MacroType;
  weight: string;
  calorie: string;
  protein: string;
  carbohydrate: string;
  fat: string;
  fiber: string;
  cooking: string;
};

const sourcePage = "dashboard_diet_plate";
const category = "dashboard_diet_food";
const emptyDraft: FoodDraft = {
  name: "",
  mealType: "breakfast",
  macroType: "carbohydrate",
  weight: "",
  calorie: "",
  protein: "",
  carbohydrate: "",
  fat: "",
  fiber: "",
  cooking: ""
};

const mealLabels: Record<DietMealType, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐"
};

const macroLabels: Record<MacroType, string> = {
  carbohydrate: "碳水",
  protein: "蛋白质",
  fat: "脂肪"
};

function buildEmptyRecommendation(): DietRecommendationSnapshot {
  return {
    id: "empty-dashboard-diet-plate",
    date: new Date().toISOString(),
    userGoal: "manual",
    totalCalorie: 0,
    targetCalorie: 0,
    nutritionRatio: {
      carbohydrate: 0,
      protein: 0,
      fat: 0
    },
    nutritionDetail: {
      protein: { target: 0, recommend: 0, remaining: 0 },
      carbohydrate: { target: 0, recommend: 0, remaining: 0 },
      fat: { target: 0, recommend: 0, remaining: 0 },
      fiber: { target: 0, recommend: 0, remaining: 0 }
    },
    meals: [
      { mealType: "breakfast", totalCalorie: 0, foods: [] },
      { mealType: "lunch", totalCalorie: 0, foods: [] },
      { mealType: "dinner", totalCalorie: 0, foods: [] }
    ],
    agentTips: [],
    remark: "暂无餐盘数据。",
    fitTips: "请在下方添加真实食物后生成今日餐盘。"
  };
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function valueAsRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function draftFromEntry(entry: ManualContextEntry): FoodDraft {
  const value = valueAsRecord(entry.value);

  return {
    name: typeof value.name === "string" ? value.name : entry.title,
    mealType:
      value.mealType === "breakfast" || value.mealType === "lunch" || value.mealType === "dinner"
        ? value.mealType
        : "breakfast",
    macroType:
      value.macroType === "protein" || value.macroType === "fat" || value.macroType === "carbohydrate"
        ? value.macroType
        : "carbohydrate",
    weight: String(toNumber(value.weight)),
    calorie: String(toNumber(value.calorie)),
    protein: String(toNumber(value.protein)),
    carbohydrate: String(toNumber(value.carbohydrate)),
    fat: String(toNumber(value.fat)),
    fiber: String(toNumber(value.fiber)),
    cooking: typeof value.cooking === "string" ? value.cooking : ""
  };
}

function buildPayload(draft: FoodDraft): ManualContextPayload {
  const name = draft.name.trim();
  const macroType = draft.macroType;
  const payloadValue = {
    name,
    mealType: draft.mealType,
    macroType,
    weight: toNumber(draft.weight),
    calorie: toNumber(draft.calorie),
    protein: toNumber(draft.protein),
    carbohydrate: toNumber(draft.carbohydrate),
    fat: toNumber(draft.fat),
    fiber: toNumber(draft.fiber),
    cooking: draft.cooking.trim()
  };

  return {
    sourcePage,
    title: name,
    content: `${mealLabels[draft.mealType]} ${macroLabels[macroType]}来源：${name}`,
    category,
    tags: ["dashboard", "diet_plate", macroType, draft.mealType],
    value: payloadValue
  };
}

function foodFromEntry(entry: ManualContextEntry): DietFood & { mealType: DietMealType } {
  const value = valueAsRecord(entry.value);
  const mealType =
    value.mealType === "breakfast" || value.mealType === "lunch" || value.mealType === "dinner"
      ? value.mealType
      : "breakfast";

  return {
    mealType,
    name: typeof value.name === "string" ? value.name : entry.title,
    weight: toNumber(value.weight),
    calorie: toNumber(value.calorie),
    cooking: typeof value.cooking === "string" ? value.cooking : "手动记录",
    nutrition: {
      protein: toNumber(value.protein),
      carbohydrate: toNumber(value.carbohydrate),
      fat: toNumber(value.fat),
      fiber: toNumber(value.fiber)
    },
    replaceable: []
  };
}

function buildManualRecommendation(entries: ManualContextEntry[]): DietRecommendationSnapshot | null {
  if (entries.length === 0) {
    return null;
  }

  const foods = entries.map(foodFromEntry);
  const meals: DietMeal[] = (["breakfast", "lunch", "dinner"] as DietMealType[]).map((mealType) => {
    const mealFoods = foods.filter((food) => food.mealType === mealType);
    return {
      mealType,
      totalCalorie: mealFoods.reduce((sum, food) => sum + food.calorie, 0),
      foods: mealFoods
    };
  });

  const totals = foods.reduce(
    (sum, food) => ({
      calorie: sum.calorie + food.calorie,
      protein: sum.protein + food.nutrition.protein,
      carbohydrate: sum.carbohydrate + food.nutrition.carbohydrate,
      fat: sum.fat + food.nutrition.fat,
      fiber: sum.fiber + (food.nutrition.fiber ?? 0)
    }),
    { calorie: 0, protein: 0, carbohydrate: 0, fat: 0, fiber: 0 }
  );
  const macroTotal = totals.protein + totals.carbohydrate + totals.fat || 1;
  const carbohydrate = Math.round((totals.carbohydrate / macroTotal) * 100);
  const protein = Math.round((totals.protein / macroTotal) * 100);

  return {
    id: "manual-dashboard-diet-plate",
    date: new Date().toISOString(),
    userGoal: "manual",
    totalCalorie: Math.round(totals.calorie),
    targetCalorie: Math.round(totals.calorie),
    nutritionRatio: {
      carbohydrate,
      protein,
      fat: Math.max(0, 100 - carbohydrate - protein)
    },
    nutritionDetail: {
      protein: { target: totals.protein, recommend: totals.protein, remaining: 0 },
      carbohydrate: { target: totals.carbohydrate, recommend: totals.carbohydrate, remaining: 0 },
      fat: { target: totals.fat, recommend: totals.fat, remaining: 0 },
      fiber: { target: totals.fiber, recommend: totals.fiber, remaining: 0 }
    },
    meals,
    agentTips: [],
    remark: "手动维护的今日餐盘。",
    fitTips: "这些食物来自你手动保存的餐盘数据。"
  };
}

export function DashboardDietPlateManager({
  recommendation
}: {
  recommendation: DietRecommendationSnapshot | null;
}) {
  const [items, setItems] = useState<ManualContextEntry[]>([]);
  const [draft, setDraft] = useState<FoodDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<FoodDraft>(emptyDraft);
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
          setError(cause instanceof Error ? cause.message : "无法读取餐盘数据。");
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

  const manualRecommendation = useMemo(() => buildManualRecommendation(items), [items]);
  const visibleRecommendation = manualRecommendation ?? recommendation ?? buildEmptyRecommendation();
  const canSave = draft.name.trim().length > 0;

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) {
      setError("请填写食物名称。");
      return;
    }

    setPendingId("new");
    setMessage("");
    setError("");

    try {
      const created = await createManualContext(buildPayload(draft));
      setItems((current) => [created, ...current]);
      setDraft(emptyDraft);
      setMessage("餐盘食物已保存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
    } finally {
      setPendingId(null);
    }
  }

  async function handleUpdate(entryId: string) {
    if (editingDraft.name.trim().length === 0) {
      setError("请填写食物名称。");
      return;
    }

    setPendingId(entryId);
    setMessage("");
    setError("");

    try {
      const updated = await updateManualContext(entryId, buildPayload(editingDraft));
      setItems((current) => current.map((item) => (item.id === entryId ? updated : item)));
      setEditingId(null);
      setMessage("餐盘食物已更新。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新失败。");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(entryId: string) {
    setPendingId(entryId);
    setMessage("");
    setError("");

    try {
      await deleteManualContext(entryId);
      setItems((current) => current.filter((item) => item.id !== entryId));
      setMessage("餐盘食物已删除。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败。");
    } finally {
      setPendingId(null);
    }
  }

  function renderFoodFields(value: FoodDraft, onChange: (next: FoodDraft) => void) {
    return (
      <>
        <label className="field">
          <span className="form-label">食物</span>
          <input value={value.name} placeholder="米饭" onChange={(event) => onChange({ ...value, name: event.target.value })} />
        </label>
        <label className="field">
          <span className="form-label">餐次</span>
          <select value={value.mealType} onChange={(event) => onChange({ ...value, mealType: event.target.value as DietMealType })}>
            <option value="breakfast">早餐</option>
            <option value="lunch">午餐</option>
            <option value="dinner">晚餐</option>
          </select>
        </label>
        <label className="field">
          <span className="form-label">宏量来源</span>
          <select value={value.macroType} onChange={(event) => onChange({ ...value, macroType: event.target.value as MacroType })}>
            <option value="carbohydrate">碳水</option>
            <option value="protein">蛋白质</option>
            <option value="fat">脂肪</option>
          </select>
        </label>
        <label className="field">
          <span className="form-label">重量</span>
          <input value={value.weight} inputMode="decimal" placeholder="150" onChange={(event) => onChange({ ...value, weight: event.target.value })} />
        </label>
        <label className="field">
          <span className="form-label">热量</span>
          <input value={value.calorie} inputMode="decimal" placeholder="220" onChange={(event) => onChange({ ...value, calorie: event.target.value })} />
        </label>
        <label className="field">
          <span className="form-label">蛋白质</span>
          <input value={value.protein} inputMode="decimal" placeholder="5" onChange={(event) => onChange({ ...value, protein: event.target.value })} />
        </label>
        <label className="field">
          <span className="form-label">碳水</span>
          <input value={value.carbohydrate} inputMode="decimal" placeholder="45" onChange={(event) => onChange({ ...value, carbohydrate: event.target.value })} />
        </label>
        <label className="field">
          <span className="form-label">脂肪</span>
          <input value={value.fat} inputMode="decimal" placeholder="2" onChange={(event) => onChange({ ...value, fat: event.target.value })} />
        </label>
        <label className="field">
          <span className="form-label">纤维</span>
          <input value={value.fiber} inputMode="decimal" placeholder="3" onChange={(event) => onChange({ ...value, fiber: event.target.value })} />
        </label>
        <label className="field">
          <span className="form-label">做法</span>
          <input value={value.cooking} placeholder="蒸煮" onChange={(event) => onChange({ ...value, cooking: event.target.value })} />
        </label>
      </>
    );
  }

  return (
    <section className="dashboard-diet-manager">
      <DietPlateCard recommendation={visibleRecommendation} />

      {!manualRecommendation && !recommendation ? (
        <p className="dashboard-diet-empty-note">暂无真实餐盘数据。添加食物后，上方餐盘会展示对应的碳水、蛋白质和脂肪来源。</p>
      ) : null}

      <details className="dashboard-diet-editor">
        <summary className="dashboard-editor-summary">管理餐盘食物</summary>
        <div className="manual-context-head">
          <div className="section-copy">
            <span className="section-label">餐盘食物</span>
            <h3>手动维护今日推荐餐盘</h3>
            <p className="muted">每条食物都会写入数据库。餐盘只展示这些真实食物，并按碳水、蛋白质和脂肪来源分组。</p>
          </div>
          <span className="mini-chip">{isLoading ? "读取中" : `${items.length} 种食物`}</span>
        </div>

        <form className="dashboard-diet-form" onSubmit={handleCreate}>
          {renderFoodFields(draft, setDraft)}
          <button type="submit" className="button" disabled={pendingId !== null || !canSave}>
            {pendingId === "new" ? "保存中..." : "新增食物"}
          </button>
        </form>

        <div className="manual-context-list">
          {items.map((entry) => {
            const isEditing = editingId === entry.id;
            const food = foodFromEntry(entry);
            const draftValue = draftFromEntry(entry);

            return (
              <article className="manual-context-item" key={entry.id}>
                {isEditing ? (
                  <div className="dashboard-diet-form compact">
                    {renderFoodFields(editingDraft, setEditingDraft)}
                    <div className="action-row">
                      <button type="button" className="button" disabled={pendingId !== null} onClick={() => void handleUpdate(entry.id)}>
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
                      <span className="section-label">{mealLabels[food.mealType]} · {macroLabels[draftValue.macroType]}</span>
                      <strong>{food.name}</strong>
                      <p className="muted">
                        {food.weight} 克 · {food.calorie} 千卡 · 蛋白质 {food.nutrition.protein} 克 · 碳水 {food.nutrition.carbohydrate} 克 · 脂肪 {food.nutrition.fat} 克
                      </p>
                    </div>
                    <div className="action-row">
                      <button type="button" className="ghost-button" onClick={() => { setEditingId(entry.id); setEditingDraft(draftValue); }}>
                        编辑
                      </button>
                      <button type="button" className="ghost-button danger" disabled={pendingId !== null} onClick={() => void handleDelete(entry.id)}>
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
