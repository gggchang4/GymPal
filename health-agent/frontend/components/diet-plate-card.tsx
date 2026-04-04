"use client";

import { useEffect, useState } from "react";
import { DietFoodArt } from "@/components/diet-food-art";
import { DietRecommendationModal } from "@/components/diet-recommendation-modal";
import {
  DietFood,
  DietFoodReplacement,
  DietMeal,
  DietMealType,
  DietRecommendationSnapshot
} from "@/lib/types";

type DietMacroKey = keyof DietRecommendationSnapshot["nutritionRatio"];

const macroConfig: Array<{
  key: DietMacroKey;
  label: string;
  accent: string;
  tint: string;
}> = [
  { key: "carbohydrate", label: "碳水", accent: "#d55a3c", tint: "#f5d5c5" },
  { key: "protein", label: "蛋白质", accent: "#f0a337", tint: "#f6e6c7" },
  { key: "fat", label: "脂肪", accent: "#5d8661", tint: "#d8e8d6" }
];

const mealLabelByType: Record<DietMealType, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐"
};

const macroFoodKeywords: Record<DietMacroKey, string[]> = {
  carbohydrate: [
    "rice",
    "oat",
    "toast",
    "bread",
    "quinoa",
    "corn",
    "sweet potato",
    "potato",
    "broccoli",
    "asparagus",
    "greens",
    "spinach",
    "salad",
    "berry",
    "fruit"
  ],
  protein: ["chicken", "shrimp", "prawn", "beef", "egg", "yogurt", "milk", "tofu", "bean", "edamame"],
  fat: ["salmon", "avocado", "nuts", "almond", "walnut", "olive", "oil", "peanut", "butter"]
};

function roundValue(value: number) {
  return Math.round(value * 10) / 10;
}

function foodToReplacement(food: DietFood): DietFoodReplacement {
  return {
    name: food.name,
    weight: food.weight,
    calorie: food.calorie,
    cooking: food.cooking,
    nutrition: { ...food.nutrition }
  };
}

function normalizeRatio(input: DietRecommendationSnapshot["nutritionRatio"]) {
  const total = input.carbohydrate + input.protein + input.fat;
  if (total <= 0) {
    return { carbohydrate: 34, protein: 33, fat: 33 };
  }

  const normalized = {
    carbohydrate: Math.round((input.carbohydrate / total) * 100),
    protein: Math.round((input.protein / total) * 100),
    fat: 0
  };

  normalized.fat = Math.max(0, 100 - normalized.carbohydrate - normalized.protein);
  return normalized;
}

function recalculateSnapshot(snapshot: DietRecommendationSnapshot, meals: DietMeal[]): DietRecommendationSnapshot {
  const totals = meals.reduce(
    (accumulator, meal) => {
      const mealCalories = meal.foods.reduce((sum, food) => sum + food.calorie, 0);
      const mealProtein = meal.foods.reduce((sum, food) => sum + food.nutrition.protein, 0);
      const mealCarbs = meal.foods.reduce((sum, food) => sum + food.nutrition.carbohydrate, 0);
      const mealFat = meal.foods.reduce((sum, food) => sum + food.nutrition.fat, 0);
      const mealFiber = meal.foods.reduce((sum, food) => sum + (food.nutrition.fiber ?? 0), 0);

      return {
        calorie: accumulator.calorie + mealCalories,
        protein: accumulator.protein + mealProtein,
        carbohydrate: accumulator.carbohydrate + mealCarbs,
        fat: accumulator.fat + mealFat,
        fiber: accumulator.fiber + mealFiber
      };
    },
    { calorie: 0, protein: 0, carbohydrate: 0, fat: 0, fiber: 0 }
  );

  const normalizedMeals = meals.map((meal) => ({
    ...meal,
    totalCalorie: Math.round(meal.foods.reduce((sum, food) => sum + food.calorie, 0))
  }));

  const ratio = normalizeRatio({
    carbohydrate: totals.carbohydrate,
    protein: totals.protein,
    fat: totals.fat
  });

  return {
    ...snapshot,
    totalCalorie: Math.round(totals.calorie),
    nutritionRatio: ratio,
    nutritionDetail: {
      protein: {
        ...snapshot.nutritionDetail.protein,
        recommend: roundValue(totals.protein),
        remaining: roundValue(snapshot.nutritionDetail.protein.target - totals.protein)
      },
      carbohydrate: {
        ...snapshot.nutritionDetail.carbohydrate,
        recommend: roundValue(totals.carbohydrate),
        remaining: roundValue(snapshot.nutritionDetail.carbohydrate.target - totals.carbohydrate)
      },
      fat: {
        ...snapshot.nutritionDetail.fat,
        recommend: roundValue(totals.fat),
        remaining: roundValue(snapshot.nutritionDetail.fat.target - totals.fat)
      },
      fiber: {
        ...snapshot.nutritionDetail.fiber,
        recommend: roundValue(totals.fiber),
        remaining: roundValue(snapshot.nutritionDetail.fiber.target - totals.fiber)
      }
    },
    meals: normalizedMeals
  };
}

function polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians)
  };
}

function describeSlicePath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}

function detectMacroByKeywords(name: string): DietMacroKey | null {
  const lower = name.toLowerCase();

  for (const macro of Object.keys(macroFoodKeywords) as DietMacroKey[]) {
    if (macroFoodKeywords[macro].some((keyword) => lower.includes(keyword))) {
      return macro;
    }
  }

  return null;
}

function classifyFoodMacro(food: Pick<DietFood, "name" | "nutrition">): DietMacroKey {
  const byKeyword = detectMacroByKeywords(food.name);
  if (byKeyword) {
    return byKeyword;
  }

  if (
    food.nutrition.fat >= food.nutrition.protein &&
    food.nutrition.fat >= food.nutrition.carbohydrate
  ) {
    return "fat";
  }

  if (food.nutrition.protein >= food.nutrition.carbohydrate) {
    return "protein";
  }

  return "carbohydrate";
}

function getMacroFoodNames(meals: DietMeal[]) {
  const grouped = {
    carbohydrate: [] as string[],
    protein: [] as string[],
    fat: [] as string[]
  };

  meals.forEach((meal) => {
    meal.foods.forEach((food) => {
      grouped[classifyFoodMacro(food)].push(food.name);
      food.replaceable.forEach((replacement) => {
        grouped[classifyFoodMacro(replacement)].push(replacement.name);
      });
    });
  });

  return {
    carbohydrate: Array.from(new Set(grouped.carbohydrate)).slice(0, 5),
    protein: Array.from(new Set(grouped.protein)).slice(0, 5),
    fat: Array.from(new Set(grouped.fat)).slice(0, 5)
  };
}

function getFoodPlacements(
  names: string[],
  startAngle: number,
  endAngle: number
): Array<{ name: string; x: number; y: number; rotate: number }> {
  const radiusMap = [76, 103, 88, 114, 96];
  const count = Math.max(1, names.length);
  const padding = Math.min(20, Math.max(10, (endAngle - startAngle) / 7));
  const start = startAngle + padding;
  const end = endAngle - padding;

  return names.map((name, index) => {
    const angle =
      count === 1
        ? (start + end) / 2
        : start + ((end - start) * index) / Math.max(count - 1, 1);
    const point = polarToCartesian(160, 160, radiusMap[index % radiusMap.length], angle);

    return {
      name,
      x: point.x,
      y: point.y,
      rotate: index % 2 === 0 ? -8 : 8
    };
  });
}

export function DietPlateCard({ recommendation }: { recommendation: DietRecommendationSnapshot }) {
  const [snapshot, setSnapshot] = useState(recommendation);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeMeal, setActiveMeal] = useState<DietMealType>("breakfast");
  const [activeMacro, setActiveMacro] = useState<DietMacroKey>("carbohydrate");
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setSnapshot(recommendation);
  }, [recommendation]);

  useEffect(() => {
    setIsRefreshing(true);
    const timer = window.setTimeout(() => setIsRefreshing(false), 440);
    return () => window.clearTimeout(timer);
  }, [
    snapshot.totalCalorie,
    snapshot.nutritionRatio.carbohydrate,
    snapshot.nutritionRatio.protein,
    snapshot.nutritionRatio.fat
  ]);

  function openModal(macro?: DietMacroKey) {
    if (macro) {
      setActiveMacro(macro);
    }
    setIsModalOpen(true);
  }

  function handleReplaceFood(mealType: DietMealType, foodIndex: number, replacementIndex: number) {
    setSnapshot((current) => {
      const nextMeals = current.meals.map((meal) => ({
        ...meal,
        foods: meal.foods.map((food) => ({
          ...food,
          nutrition: { ...food.nutrition },
          replaceable: food.replaceable.map((replacement) => ({
            ...replacement,
            nutrition: { ...replacement.nutrition }
          }))
        }))
      }));

      const meal = nextMeals.find((item) => item.mealType === mealType);
      if (!meal) {
        return current;
      }

      const currentFood = meal.foods[foodIndex];
      if (!currentFood) {
        return current;
      }

      const replacement = currentFood.replaceable[replacementIndex];
      if (!replacement) {
        return current;
      }

      const updatedReplaceable = [
        foodToReplacement(currentFood),
        ...currentFood.replaceable.filter((_, index) => index !== replacementIndex)
      ];

      meal.foods[foodIndex] = {
        name: replacement.name,
        weight: replacement.weight,
        calorie: replacement.calorie,
        cooking: replacement.cooking,
        nutrition: { ...replacement.nutrition },
        replaceable: updatedReplaceable
      };

      return recalculateSnapshot(current, nextMeals);
    });
  }

  const calorieGap = snapshot.targetCalorie - snapshot.totalCalorie;
  const macroFoodNames = getMacroFoodNames(snapshot.meals);
  const segments = [];
  let startAngle = 0;

  for (const macro of macroConfig) {
    const angle = (snapshot.nutritionRatio[macro.key] / 100) * 360;
    segments.push({
      ...macro,
      value: snapshot.nutritionRatio[macro.key],
      startAngle,
      endAngle: startAngle + angle,
      foods: getFoodPlacements(macroFoodNames[macro.key], startAngle, startAngle + angle)
    });
    startAngle += angle;
  }

  return (
    <>
      <section className="diet-plate-panel">
        <div className="section-head">
          <div className="section-copy">
            <span className="section-label">Diet</span>
            <h3>今日推荐餐盘</h3>
            <p className="muted">
              盘中只展示当前宏量对应的真实食物，让碳水、蛋白质和脂肪的来源一眼就能分清。
            </p>
          </div>
          <button className="ghost-button" type="button" onClick={() => openModal(activeMacro)}>
            查看详情
          </button>
        </div>

        <div className="diet-plate-layout">
          <div className="diet-plate-stage">
            <svg
              viewBox="0 0 320 320"
              className={`diet-plate-visual ${isRefreshing ? "refreshing" : ""}`}
              aria-label="今日饮食推荐餐盘"
            >
              <circle cx="160" cy="160" r="145" className="diet-plate-shadow" />
              <circle cx="160" cy="160" r="138" className="diet-plate-shell" />
              <circle cx="160" cy="160" r="119" className="diet-plate-surface" />

              {segments.map((segment) => (
                <path
                  key={segment.key}
                  d={describeSlicePath(160, 160, 116, segment.startAngle, segment.endAngle)}
                  fill={segment.tint}
                  className={`diet-plate-slice ${activeMacro === segment.key ? "active" : ""}`}
                  onClick={() => openModal(segment.key)}
                  onMouseEnter={() => setActiveMacro(segment.key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openModal(segment.key);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${segment.label} ${segment.value}%`}
                />
              ))}

              <circle cx="160" cy="160" r="58" className="diet-plate-center-ring" />
            </svg>

            <div className="diet-plate-food-layer">
              {segments.flatMap((segment) =>
                segment.foods.map((food, index) => (
                  <button
                    key={`${segment.key}-${food.name}-${index}`}
                    className={`diet-plate-food-token ${activeMacro === segment.key ? "active" : ""}`}
                    type="button"
                    style={{
                      left: `${food.x}px`,
                      top: `${food.y}px`,
                      transform: `translate(-50%, -50%) rotate(${food.rotate}deg)`
                    }}
                    onMouseEnter={() => setActiveMacro(segment.key)}
                    onClick={() => openModal(segment.key)}
                    aria-label={`${food.name}，查看${segment.label}详情`}
                  >
                    <DietFoodArt name={food.name} variant="token" />
                  </button>
                ))
              )}
            </div>

            <div className="diet-plate-center">
              <span className="metric-label">今日摄入</span>
              <strong>{snapshot.totalCalorie}</strong>
              <p>kcal</p>
            </div>
          </div>

          <div className="diet-plate-copy">
            <div className="diet-kpi-grid">
              <div className="diet-kpi-card">
                <span className="metric-label">目标热量</span>
                <strong>{snapshot.targetCalorie} kcal</strong>
                <small>先稳定结构，再去优化热量。</small>
              </div>
              <div className="diet-kpi-card">
                <span className="metric-label">{calorieGap >= 0 ? "热量缺口" : "热量盈余"}</span>
                <strong>{Math.abs(calorieGap)} kcal</strong>
                <small>{snapshot.fitTips ?? "优先把蛋白质和蔬菜执行稳定。"}</small>
              </div>
            </div>

            <div className="diet-legend">
              {segments.map((macro) => (
                <button
                  key={macro.key}
                  className={`diet-legend-row ${activeMacro === macro.key ? "active" : ""}`}
                  type="button"
                  onMouseEnter={() => setActiveMacro(macro.key)}
                  onClick={() => openModal(macro.key)}
                >
                  <span className="diet-legend-dot" style={{ backgroundColor: macro.accent }} />
                  <div>
                    <span>{macro.label}</span>
                    <strong>
                      {snapshot.nutritionRatio[macro.key]}% · {snapshot.nutritionDetail[macro.key].recommend}g
                    </strong>
                    <small>{macroFoodNames[macro.key].slice(0, 3).join(" · ")}</small>
                  </div>
                </button>
              ))}
            </div>

            <div className="diet-meal-preview">
              {snapshot.meals.map((meal) => (
                <button
                  key={meal.mealType}
                  className={`diet-meal-chip ${activeMeal === meal.mealType ? "active" : ""}`}
                  type="button"
                  onClick={() => {
                    setActiveMeal(meal.mealType);
                    openModal(activeMacro);
                  }}
                >
                  <span>{mealLabelByType[meal.mealType]}</span>
                  <strong>{meal.totalCalorie} kcal</strong>
                  <small>{meal.foods.map((food) => food.name).slice(0, 2).join(" · ")}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <DietRecommendationModal
        isOpen={isModalOpen}
        snapshot={snapshot}
        activeMeal={activeMeal}
        activeMacro={activeMacro}
        onMealChange={setActiveMeal}
        onClose={() => setIsModalOpen(false)}
        onReplaceFood={handleReplaceFood}
      />
    </>
  );
}
