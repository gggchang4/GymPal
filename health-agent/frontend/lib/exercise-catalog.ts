import type { ExerciseItem } from "@/lib/types";

export type ExerciseCatalogItem = ExerciseItem & {
  category: string;
  mechanic: string | null;
  force: string | null;
  searchText: string;
};

export function buildEquipmentOptions(catalog: ExerciseCatalogItem[]) {
  return Array.from(
    new Map(
      catalog.map((item) => [
        item.equipmentKey ?? "other",
        {
          key: item.equipmentKey ?? "other",
          label: item.equipment
        }
      ])
    ).values()
  ).sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

function resolvePreferredGroup(todayFocus: string) {
  const focus = todayFocus.toLowerCase();

  if (focus.includes("下肢") || focus.includes("腿") || focus.includes("lower")) {
    return "腿部";
  }

  if (focus.includes("核心") || focus.includes("腹") || focus.includes("core")) {
    return "核心";
  }

  if (focus.includes("背") || focus.includes("pull")) {
    return "背部";
  }

  if (focus.includes("胸") || focus.includes("push")) {
    return "胸部";
  }

  if (focus.includes("肩")) {
    return "肩部";
  }

  if (focus.includes("臂") || focus.includes("手臂")) {
    return "手臂";
  }

  if (focus.includes("颈")) {
    return "颈部";
  }

  return null;
}

function scoreExercise(item: ExerciseCatalogItem) {
  let score = 0;

  if (item.category === "力量") {
    score += 5;
  } else if (item.category === "力量举" || item.category === "奥举") {
    score += 4;
  } else if (item.category === "增强式") {
    score += 3;
  } else if (item.category === "有氧") {
    score += 2;
  } else if (item.category === "拉伸") {
    score += 1;
  }

  if (item.mechanic === "复合") {
    score += 3;
  } else if (item.mechanic === "孤立") {
    score += 1;
  }

  if (item.level === "初级") {
    score += 2;
  } else if (item.level === "中级") {
    score += 1;
  }

  if (item.equipmentKey && item.equipmentKey !== "accessory") {
    score += 1;
  }

  return score;
}

export function getRecommendedExercises(
  catalog: ExerciseCatalogItem[],
  todayFocus: string,
  count = 4
) {
  const preferredGroup = resolvePreferredGroup(todayFocus);
  const candidates =
    preferredGroup === null
      ? catalog
      : catalog.filter((item) => item.primaryGroup === preferredGroup);

  return [...candidates]
    .sort((left, right) => scoreExercise(right) - scoreExercise(left) || left.name.localeCompare(right.name))
    .slice(0, count);
}
