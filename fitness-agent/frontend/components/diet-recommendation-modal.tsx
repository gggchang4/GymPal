"use client";

import Link from "next/link";
import { useEffect } from "react";
import { DietFoodArt } from "@/components/diet-food-art";
import { appRoutes } from "@/lib/routes";
import type { DietMealType, DietRecommendationSnapshot } from "@/lib/types";

type DietMacroKey = keyof DietRecommendationSnapshot["nutritionRatio"];

const mealLabelByType: Record<DietMealType, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐"
};

const macroLabelByKey: Record<DietMacroKey, string> = {
  carbohydrate: "碳水",
  protein: "蛋白质",
  fat: "脂肪"
};

const macroAccentByKey: Record<DietMacroKey, string> = {
  carbohydrate: "#d55a3c",
  protein: "#f0a337",
  fat: "#5d8661"
};

const nutritionRows: Array<{
  key: keyof DietRecommendationSnapshot["nutritionDetail"];
  label: string;
  unit: string;
}> = [
  { key: "protein", label: "蛋白质", unit: "g" },
  { key: "carbohydrate", label: "碳水", unit: "g" },
  { key: "fat", label: "脂肪", unit: "g" },
  { key: "fiber", label: "膳食纤维", unit: "g" }
];

function buildConicGradient(segments: Array<{ value: number; color: string }>) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
  let current = 0;

  return `conic-gradient(${segments
    .map((segment) => {
      const start = (current / total) * 360;
      current += segment.value;
      const end = (current / total) * 360;
      return `${segment.color} ${start}deg ${end}deg`;
    })
    .join(", ")})`;
}

function formatPercent(value: number, total: number) {
  if (!total) {
    return 0;
  }
  return Math.round((value / total) * 100);
}

function DietDonutChart({
  title,
  subtitle,
  centerValue,
  centerLabel,
  unit,
  segments
}: {
  title: string;
  subtitle: string;
  centerValue: string;
  centerLabel: string;
  unit: string;
  segments: Array<{ label: string; value: number; color: string }>;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <article className="diet-chart-card">
      <div className="diet-chart-head">
        <div>
          <span className="section-label">图表</span>
          <h4>{title}</h4>
        </div>
        <p className="muted">{subtitle}</p>
      </div>

      <div className="diet-chart-layout">
        <div className="diet-donut-shell" style={{ background: buildConicGradient(segments) }}>
          <div className="diet-donut-core">
            <strong>{centerValue}</strong>
            <span>{centerLabel}</span>
          </div>
        </div>

        <div className="diet-chart-legend">
          {segments.map((segment) => (
            <div className="diet-chart-row" key={segment.label}>
              <span className="diet-chart-dot" style={{ backgroundColor: segment.color }} />
              <div>
                <span>{segment.label}</span>
                <strong>
                  {segment.value}
                  {unit}
                </strong>
              </div>
              <small>{formatPercent(segment.value, total)}%</small>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

export function DietRecommendationModal({
  isOpen,
  snapshot,
  activeMeal,
  activeMacro,
  onMealChange,
  onClose,
  onReplaceFood
}: {
  isOpen: boolean;
  snapshot: DietRecommendationSnapshot;
  activeMeal: DietMealType;
  activeMacro: DietMacroKey;
  onMealChange: (mealType: DietMealType) => void;
  onClose: () => void;
  onReplaceFood: (mealType: DietMealType, foodIndex: number, replacementIndex: number) => void;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const activeMealData = snapshot.meals.find((meal) => meal.mealType === activeMeal) ?? snapshot.meals[0];
  const calorieGap = snapshot.targetCalorie - snapshot.totalCalorie;
  const calorieGapLabel = calorieGap >= 0 ? "热量缺口" : "热量盈余";
  const activeMealProtein = activeMealData.foods.reduce((sum, food) => sum + food.nutrition.protein, 0);
  const activeMealCarbs = activeMealData.foods.reduce((sum, food) => sum + food.nutrition.carbohydrate, 0);
  const activeMealFat = activeMealData.foods.reduce((sum, food) => sum + food.nutrition.fat, 0);

  return (
    <div className="diet-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="diet-modal premium"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diet-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="diet-modal-header">
          <div>
            <span className="section-label">饮食工作台</span>
            <h3 id="diet-modal-title">今日饮食建议</h3>
            <p className="muted">把结构、餐次和替换方案放进同一块面板里，阅读更专注，也更适合快速决策。</p>
          </div>
          <button className="diet-icon-button" type="button" onClick={onClose} aria-label="关闭饮食建议">
            ×
          </button>
        </div>

        <div className="diet-modal-body premium">
          <section className="diet-modal-hero refined">
            <div className="diet-hero-copy">
              <span className="section-label">总览</span>
              <h4>{snapshot.userGoal === "fat_loss" ? "减脂餐盘" : snapshot.userGoal}</h4>
              <p className="diet-hero-note">
                {snapshot.fitTips ?? "保持高蛋白、适量碳水和稳定饱腹感，把饮食执行做得更轻松。"}
              </p>
            </div>

            <div className="diet-hero-metrics">
              <div>
                <span className="metric-label">目标热量</span>
                <strong>{snapshot.targetCalorie}</strong>
                <small>kcal</small>
              </div>
              <div>
                <span className="metric-label">推荐摄入</span>
                <strong>{snapshot.totalCalorie}</strong>
                <small>kcal</small>
              </div>
              <div>
                <span className="metric-label">{calorieGapLabel}</span>
                <strong>{Math.abs(calorieGap)}</strong>
                <small>kcal</small>
              </div>
              <div className="diet-focus-inline">
                <span className="metric-label">当前重点</span>
                <strong>{macroLabelByKey[activeMacro]}</strong>
                <small>{snapshot.nutritionDetail[activeMacro].recommend}g</small>
              </div>
            </div>
          </section>

          <section className="diet-insight-panel">
            <div className="diet-panel-head">
              <div className="section-copy">
                <span className="section-label">洞察</span>
                <h4>整体结构</h4>
              </div>
              <p className="muted">把今天的宏量构成、三餐热量分配和当前餐内结构合并在一组图中查看。</p>
            </div>

            <div className="diet-chart-grid compact">
              <DietDonutChart
                title="整体宏量占比"
                subtitle="基于今日推荐摄入"
                centerValue={`${snapshot.totalCalorie}`}
                centerLabel="kcal"
                unit="g"
                segments={[
                  {
                    label: "碳水",
                    value: snapshot.nutritionDetail.carbohydrate.recommend,
                    color: macroAccentByKey.carbohydrate
                  },
                  {
                    label: "蛋白质",
                    value: snapshot.nutritionDetail.protein.recommend,
                    color: macroAccentByKey.protein
                  },
                  {
                    label: "脂肪",
                    value: snapshot.nutritionDetail.fat.recommend,
                    color: macroAccentByKey.fat
                  }
                ]}
              />

              <DietDonutChart
                title="三餐热量分配"
                subtitle="配合下方餐次切换查看"
                centerValue={`${activeMealData.totalCalorie}`}
                centerLabel={mealLabelByType[activeMealData.mealType]}
                unit=" kcal"
                segments={snapshot.meals.map((meal, index) => ({
                  label: mealLabelByType[meal.mealType],
                  value: meal.totalCalorie,
                  color: ["#d55a3c", "#efad47", "#5d8661"][index] ?? "#8a8a8a"
                }))}
              />

              <DietDonutChart
                title="当前餐宏量结构"
                subtitle="聚焦当前选中的餐次"
                centerValue={mealLabelByType[activeMealData.mealType]}
                centerLabel={`${activeMealData.totalCalorie} kcal`}
                unit="g"
                segments={[
                  { label: "碳水", value: Math.round(activeMealCarbs), color: macroAccentByKey.carbohydrate },
                  { label: "蛋白质", value: Math.round(activeMealProtein), color: macroAccentByKey.protein },
                  { label: "脂肪", value: Math.round(activeMealFat), color: macroAccentByKey.fat }
                ]}
              />
            </div>
          </section>

          <section className="diet-meal-section refined">
            <div className="diet-panel-head">
              <div className="section-copy">
                <span className="section-label">餐次</span>
                <h4>餐次拆解</h4>
              </div>
            </div>

            <div className="diet-meal-distribution interactive">
              {snapshot.meals.map((meal) => (
                <button
                  key={meal.mealType}
                  className={`diet-distribution-row ${meal.mealType === activeMeal ? "active" : ""}`}
                  type="button"
                  onClick={() => onMealChange(meal.mealType)}
                >
                  <div className="diet-distribution-head">
                    <span>{mealLabelByType[meal.mealType]}</span>
                    <strong>{meal.totalCalorie} kcal</strong>
                  </div>
                  <div className="diet-distribution-track" aria-hidden="true">
                    <span
                      className="diet-distribution-fill"
                      style={{ width: `${(meal.totalCalorie / snapshot.totalCalorie) * 100}%` }}
                    />
                  </div>
                  <small>{meal.foods.map((food) => food.name).slice(0, 3).join(" · ")}</small>
                </button>
              ))}
            </div>

            <div className="diet-meal-studio refined">
              <div className="diet-meal-stage">
                <div className="diet-meal-stage-head">
                  <div>
                    <span className="section-label">当前餐次</span>
                    <h4>{mealLabelByType[activeMealData.mealType]}</h4>
                  </div>
                  <span className="mini-chip">{activeMealData.totalCalorie} kcal</span>
                </div>

                <div className="diet-meal-spotlight">
                  {activeMealData.foods.map((food) => (
                    <div className="diet-hero-food" key={`${activeMealData.mealType}-${food.name}`}>
                      <DietFoodArt name={food.name} variant="hero" />
                      <span>{food.name}</span>
                    </div>
                  ))}
                </div>

                <div className="diet-meal-macros">
                  <div>
                    <span className="metric-label">蛋白质</span>
                    <strong>{Math.round(activeMealProtein)}g</strong>
                  </div>
                  <div>
                    <span className="metric-label">碳水</span>
                    <strong>{Math.round(activeMealCarbs)}g</strong>
                  </div>
                  <div>
                    <span className="metric-label">脂肪</span>
                    <strong>{Math.round(activeMealFat)}g</strong>
                  </div>
                </div>
              </div>

              <div className="diet-food-sheet">
                {activeMealData.foods.map((food, foodIndex) => {
                  const totalMacro = food.nutrition.protein + food.nutrition.carbohydrate + food.nutrition.fat;
                  const dominantMacro =
                    food.nutrition.fat >= food.nutrition.protein &&
                    food.nutrition.fat >= food.nutrition.carbohydrate
                      ? "fat"
                      : food.nutrition.protein >= food.nutrition.carbohydrate
                        ? "protein"
                        : "carbohydrate";

                  return (
                    <article
                      key={`${activeMealData.mealType}-${food.name}-${foodIndex}`}
                      className="diet-food-row premium"
                    >
                      <div className="diet-food-visual">
                        <DietFoodArt name={food.name} variant="compact" />
                      </div>

                      <div className="diet-food-copy">
                        <div className="diet-food-head">
                          <strong>{food.name}</strong>
                          <span className="mini-chip">{food.calorie} kcal</span>
                        </div>
                        <p className="muted">
                          {food.weight} g · {food.cooking}
                        </p>

                        <div className="diet-food-macrobar" aria-hidden="true">
                          <span
                            className="carb"
                            style={{ width: `${formatPercent(food.nutrition.carbohydrate, totalMacro)}%` }}
                          />
                          <span
                            className="protein"
                            style={{ width: `${formatPercent(food.nutrition.protein, totalMacro)}%` }}
                          />
                          <span
                            className="fat"
                            style={{ width: `${formatPercent(food.nutrition.fat, totalMacro)}%` }}
                          />
                        </div>

                        <p className="diet-food-caption">
                          这份食物以{macroLabelByKey[dominantMacro]}为主，蛋白质 {food.nutrition.protein}g，碳水{" "}
                          {food.nutrition.carbohydrate}g，脂肪 {food.nutrition.fat}g。
                        </p>

                        {food.replaceable.length > 0 ? (
                          <div className="diet-replace-row">
                            {food.replaceable.map((replacement, replacementIndex) => (
                              <button
                                key={`${food.name}-${replacement.name}`}
                                className="diet-replace-button"
                                type="button"
                                onClick={() => onReplaceFood(activeMealData.mealType, foodIndex, replacementIndex)}
                              >
                                换成 {replacement.name}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="diet-detail-panel">
            <article className="diet-detail-block">
              <div className="section-copy">
                <span className="section-label">营养</span>
                <h4>营养明细</h4>
              </div>

              <div className="diet-nutrient-stack">
                {nutritionRows.map((row) => {
                  const values = snapshot.nutritionDetail[row.key];
                  const progress = Math.max(0, Math.min(100, (values.recommend / Math.max(values.target, 1)) * 100));

                  return (
                    <div className="diet-nutrient-row" key={row.key}>
                      <div className="diet-nutrient-copy">
                        <strong>{row.label}</strong>
                        <span>
                          {values.recommend}
                          {row.unit} / {values.target}
                          {row.unit}
                        </span>
                      </div>
                      <div className="diet-nutrient-rail" aria-hidden="true">
                        <span className="diet-nutrient-fill" style={{ width: `${progress}%` }} />
                      </div>
                      <small>
                        剩余 {values.remaining}
                        {row.unit}
                      </small>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="diet-detail-block">
              <div className="section-copy">
                <span className="section-label">说明</span>
                <h4>执行提示</h4>
              </div>

              <div className="diet-tip-list premium">
                {snapshot.remark ? <p className="diet-tip-lead">{snapshot.remark}</p> : null}
                {snapshot.agentTips.map((tip) => (
                  <p className="muted" key={tip}>
                    {tip}
                  </p>
                ))}
              </div>
            </article>
          </section>
        </div>

        <div className="diet-modal-footer">
          <span className="muted">当前替换仅保留在前端会话中，后续接入持久化后可直接同步到记录模块。</span>
          <Link className="button" href={appRoutes.logs}>
            记录今日饮食
          </Link>
        </div>
      </div>
    </div>
  );
}
