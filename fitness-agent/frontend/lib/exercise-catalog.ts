import type { ExerciseItem } from "@/lib/types";

export type ExerciseCatalogItem = ExerciseItem & {
  primaryGroup: string;
  secondaryGroup: string;
  equipmentKey: string;
  summary: string;
  prescription: string;
  cues: string[];
  notes: string[];
  category: string;
  mechanic: string | null;
  force: string | null;
  searchText: string;
};

export type OfficialExerciseCatalogSourceItem = {
  id: string;
  name: string;
  targetMuscles: string[];
  equipment: string;
  level: string;
  steps?: string[];
  commonMistakes?: string[];
  contraindicates?: string[];
  recoveryNotes?: string[];
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

function resolveEquipmentKey(equipment: string) {
  const normalized = equipment.toLowerCase();

  if (normalized.includes("哑铃") || normalized.includes("dumbbell")) return "dumbbell";
  if (normalized.includes("杠铃") || normalized.includes("barbell")) return "barbell";
  if (normalized.includes("壶铃") || normalized.includes("kettlebell")) return "kettlebell";
  if (normalized.includes("徒手") || normalized.includes("bodyweight") || normalized.includes("no equipment")) {
    return "bodyweight";
  }
  if (normalized.includes("绳索") || normalized.includes("cable")) return "cable";
  if (normalized.includes("弹力带") || normalized.includes("resistance band")) return "resistance_band";
  if (normalized.includes("器械") || normalized.includes("machine")) return "machine";
  if (normalized.includes("跑步机") || normalized.includes("treadmill")) return "machine";
  if (normalized.includes("长凳") || normalized.includes("bench")) return "bench";
  if (normalized.includes("训练箱") || normalized.includes("台阶") || normalized.includes("box")) return "plyo_box";
  if (normalized.includes("双杠") || normalized.includes("dip")) return "dip_bar";
  if (normalized.includes("引体") || normalized.includes("pull")) return "pullup_bar";
  if (normalized.includes("跳绳")) return "jump_rope";
  if (normalized.includes("战绳")) return "battle_rope";
  if (normalized.includes("药球") || normalized.includes("medicine ball")) return "medicine_ball";
  if (normalized.includes("雪橇") || normalized.includes("sled")) return "sled";

  return "accessory";
}

function includesAny(input: string, tokens: string[]) {
  return tokens.some((token) => input.includes(token));
}

function resolveGroupFromMuscleText(input: string) {
  if (includesAny(input, ["cardio", "心肺"])) return "心肺";
  if (includesAny(input, ["quad", "glute", "hamstring", "calf", "股四头", "臀", "腘绳", "小腿", "腿部"])) {
    return "下肢";
  }
  if (includesAny(input, ["core", "abs", "ab", "核心", "腹", "斜肌"])) return "核心";
  if (includesAny(input, ["lat", "back", "trap", "rhomboid", "背", "背阔", "菱形", "斜方", "下背", "肩袖"])) {
    return "背部";
  }
  if (includesAny(input, ["chest", "pec", "胸"])) return "胸部";
  if (includesAny(input, ["shoulder", "delt", "肩", "三角肌"])) return "肩部";
  if (includesAny(input, ["bicep", "tricep", "forearm", "肱二头", "肱三头", "前臂", "肱肌", "握力"])) {
    return "手臂";
  }
  if (includesAny(input, ["full body", "全身"])) return "全身";

  return null;
}

function derivePrimaryGroup(targetMuscles: string[]) {
  const firstTargetGroup = resolveGroupFromMuscleText(targetMuscles[0]?.toLowerCase() ?? "");
  if (firstTargetGroup) {
    return firstTargetGroup;
  }

  const joinedGroup = resolveGroupFromMuscleText(targetMuscles.join(" ").toLowerCase());
  if (joinedGroup) {
    return joinedGroup;
  }

  return "全身";
}

function deriveSecondaryGroup(targetMuscles: string[]) {
  return targetMuscles[0] ?? "综合";
}

function resolveCategory(primaryGroup: string) {
  if (primaryGroup === "心肺") {
    return "Cardio";
  }

  if (primaryGroup === "全身") {
    return "Conditioning";
  }

  return "Strength";
}

function resolveMechanic(targetMuscles: string[]) {
  return targetMuscles.length > 1 ? "Compound" : "Isolation";
}

function resolvePrescription(category: string, mechanic: string | null) {
  if (category === "Cardio") {
    return "20-40 分钟";
  }

  if (category === "Conditioning") {
    return "3-6 组 x 20-45 秒";
  }

  return mechanic === "Compound" ? "3-5 组 x 6-10 次" : "3-4 组 x 10-15 次";
}

function buildSummary(item: OfficialExerciseCatalogSourceItem, category: string) {
  const categoryLabel =
    category === "Cardio" ? "心肺训练动作" : category === "Conditioning" ? "综合体能动作" : "力量训练动作";

  return `${categoryLabel}，主要刺激${item.targetMuscles.join("、")}。`;
}

export function mapOfficialExercise(item: OfficialExerciseCatalogSourceItem): ExerciseCatalogItem {
  const primaryGroup = derivePrimaryGroup(item.targetMuscles);
  const secondaryGroup = deriveSecondaryGroup(item.targetMuscles);
  const category = resolveCategory(primaryGroup);
  const mechanic = resolveMechanic(item.targetMuscles);
  const cues = item.steps ?? [];
  const notes = [
    ...(item.commonMistakes ?? []),
    ...(item.contraindicates ?? []),
    ...(item.recoveryNotes ?? [])
  ];

  return {
    id: item.id,
    name: item.name,
    primaryGroup,
    secondaryGroup,
    targetMuscles: item.targetMuscles,
    equipment: item.equipment,
    equipmentKey: resolveEquipmentKey(item.equipment),
    level: item.level,
    summary: buildSummary(item, category),
    prescription: resolvePrescription(category, mechanic),
    cues,
    notes: notes.length > 0 ? notes : ["暂无额外注意事项。"],
    category,
    mechanic,
    force: null,
    searchText: [
      item.id,
      item.name,
      primaryGroup,
      secondaryGroup,
      item.equipment,
      item.level,
      ...item.targetMuscles,
      ...cues,
      ...notes
    ]
      .join(" ")
      .toLowerCase()
  };
}

function resolvePreferredGroup(todayFocus: string) {
  const focus = todayFocus.toLowerCase();

  if (
    focus.includes("lower") ||
    focus.includes("leg") ||
    focus.includes("glute") ||
    focus.includes("下肢") ||
    focus.includes("腿") ||
    focus.includes("臀")
  ) {
    return "下肢";
  }

  if (focus.includes("core") || focus.includes("abs") || focus.includes("核心") || focus.includes("腹")) {
    return "核心";
  }

  if (
    focus.includes("pull") ||
    focus.includes("back") ||
    focus.includes("lat") ||
    focus.includes("背") ||
    focus.includes("拉")
  ) {
    return "背部";
  }

  if (focus.includes("push") || focus.includes("chest") || focus.includes("胸") || focus.includes("推")) {
    return "胸部";
  }

  if (focus.includes("shoulder") || focus.includes("delt") || focus.includes("肩")) {
    return "肩部";
  }

  if (
    focus.includes("arm") ||
    focus.includes("bicep") ||
    focus.includes("tricep") ||
    focus.includes("手臂") ||
    focus.includes("肱")
  ) {
    return "手臂";
  }

  if (
    focus.includes("cardio") ||
    focus.includes("conditioning") ||
    focus.includes("run") ||
    focus.includes("有氧") ||
    focus.includes("心肺")
  ) {
    return "心肺";
  }

  return null;
}

function scoreExercise(item: ExerciseCatalogItem) {
  let score = 0;

  if (item.category === "Strength") {
    score += 5;
  } else if (item.category === "Cardio") {
    score += 4;
  }

  if (item.mechanic === "Compound") {
    score += 3;
  } else if (item.mechanic === "Isolation") {
    score += 1;
  }

  if (item.level === "novice" || item.level === "新手") {
    score += 2;
  } else if (
    item.level === "novice_intermediate" ||
    item.level === "intermediate" ||
    item.level === "新手进阶" ||
    item.level === "进阶"
  ) {
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
