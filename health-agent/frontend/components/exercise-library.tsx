"use client";

import { useEffect, useMemo, useState } from "react";
import { ExerciseEquipmentIcon } from "@/components/exercise-equipment-icon";

type ExerciseCatalogItem = {
  id: string;
  name: string;
  primaryGroup: string;
  secondaryGroup: string;
  targetMuscles: string[];
  equipment: string;
  equipmentKey: string;
  level: string;
  summary: string;
  prescription: string;
  cues: string[];
  notes: string[];
};

const equipmentOptions = [
  { key: "dumbbell", label: "哑铃" },
  { key: "kettlebell", label: "壶铃" },
  { key: "barbell", label: "杠铃" },
  { key: "ez_bar", label: "EZ 杠" },
  { key: "trap_bar", label: "陷阱杠" },
  { key: "cable", label: "拉力器" },
  { key: "machine", label: "固定器械" },
  { key: "smith_machine", label: "史密斯" },
  { key: "bodyweight", label: "自重" },
  { key: "pullup_bar", label: "单杠" },
  { key: "dip_bar", label: "双杠" },
  { key: "resistance_band", label: "弹力带" },
  { key: "landmine", label: "地雷杆" },
  { key: "ab_wheel", label: "健腹轮" },
  { key: "medicine_ball", label: "药球" }
] as const;

const exerciseCatalog: ExerciseCatalogItem[] = [
  {
    id: "incline-dumbbell-press",
    name: "上斜哑铃卧推",
    primaryGroup: "胸",
    secondaryGroup: "上胸",
    targetMuscles: ["上胸", "前三角", "肱三头"],
    equipment: "哑铃",
    equipmentKey: "dumbbell",
    level: "初中级",
    summary: "更适合把刺激放到上胸，同时保持左右两侧输出更均衡。",
    prescription: "4 组 × 8-10 次",
    cues: ["凳面调到 30-45 度", "下放时肘部略低于肩", "顶端不要撞哑铃"],
    notes: ["适合推训练日优先动作", "肩不适时可把角度调低"]
  },
  {
    id: "flat-barbell-bench-press",
    name: "杠铃平板卧推",
    primaryGroup: "胸",
    secondaryGroup: "中胸",
    targetMuscles: ["中胸", "前三角", "肱三头"],
    equipment: "杠铃",
    equipmentKey: "barbell",
    level: "中级",
    summary: "最稳定的推举基础动作之一，适合建立胸部整体力量。",
    prescription: "4 组 × 5-8 次",
    cues: ["肩胛后缩下沉", "脚跟稳定发力", "杠铃落点在下胸上方"],
    notes: ["适合做胸部主力动作", "可配合保护杆或保护者"]
  },
  {
    id: "cable-low-to-high-fly",
    name: "绳索低位夹胸",
    primaryGroup: "胸",
    secondaryGroup: "上胸",
    targetMuscles: ["上胸", "胸内侧"],
    equipment: "拉力器",
    equipmentKey: "cable",
    level: "新手友好",
    summary: "用更连续的张力补足胸部收缩感，适合放在主动作之后。",
    prescription: "3 组 × 12-15 次",
    cues: ["保持手臂弧线固定", "夹到胸前略停 1 秒", "不要耸肩借力"],
    notes: ["适合作为胸部孤立补充", "动作节奏尽量慢"]
  },
  {
    id: "dips-forward-lean",
    name: "前倾双杠臂屈伸",
    primaryGroup: "胸",
    secondaryGroup: "下胸",
    targetMuscles: ["下胸", "肱三头", "前三角"],
    equipment: "双杠",
    equipmentKey: "dip_bar",
    level: "中高级",
    summary: "通过前倾角度把刺激更多放到下胸和胸外沿。",
    prescription: "3 组 × 8-12 次",
    cues: ["身体轻微前倾", "下放到肩前方有拉伸感", "避免完全锁死肘关节"],
    notes: ["肩关节灵活性不足时可改器械臂屈伸"]
  },
  {
    id: "seated-dumbbell-press",
    name: "坐姿哑铃推举",
    primaryGroup: "肩",
    secondaryGroup: "前束",
    targetMuscles: ["前三角", "中束", "肱三头"],
    equipment: "哑铃",
    equipmentKey: "dumbbell",
    level: "初中级",
    summary: "比站姿更容易稳定躯干，适合作为肩部主推动作。",
    prescription: "4 组 × 8-10 次",
    cues: ["腰背贴稳凳面", "手肘略在手腕下方", "顶端保持肩不耸"],
    notes: ["适合肩日开场动作"]
  },
  {
    id: "dumbbell-lateral-raise",
    name: "哑铃侧平举",
    primaryGroup: "肩",
    secondaryGroup: "中束",
    targetMuscles: ["三角肌中束"],
    equipment: "哑铃",
    equipmentKey: "dumbbell",
    level: "新手友好",
    summary: "最直接的肩中束孤立动作之一，适合雕刻肩宽线条。",
    prescription: "4 组 × 12-15 次",
    cues: ["手肘微屈固定", "上抬到与肩同高", "离心阶段慢放"],
    notes: ["重量轻一点更容易做准"]
  },
  {
    id: "reverse-pec-deck",
    name: "反向蝴蝶机飞鸟",
    primaryGroup: "肩",
    secondaryGroup: "后束",
    targetMuscles: ["三角肌后束", "上背"],
    equipment: "固定器械",
    equipmentKey: "machine",
    level: "新手友好",
    summary: "能稳定轨迹，更专注肩后束发力和肩胛控制。",
    prescription: "3 组 × 12-15 次",
    cues: ["胸口贴稳垫面", "手肘带动动作", "顶端略停"],
    notes: ["适合久坐圆肩人群补充"]
  },
  {
    id: "face-pull",
    name: "绳索面拉",
    primaryGroup: "肩",
    secondaryGroup: "后束",
    targetMuscles: ["三角肌后束", "菱形肌", "斜方肌中下束"],
    equipment: "拉力器",
    equipmentKey: "cable",
    level: "新手友好",
    summary: "后束和肩胛稳定都能兼顾，适合作为肩健康动作。",
    prescription: "3 组 × 12-15 次",
    cues: ["绳索拉向眉线", "肘部打开", "不要借腰后仰"],
    notes: ["可安排在拉日末端"]
  },
  {
    id: "lat-pulldown",
    name: "高位下拉",
    primaryGroup: "背",
    secondaryGroup: "背阔肌",
    targetMuscles: ["背阔肌", "大圆肌", "肱二头"],
    equipment: "拉力器",
    equipmentKey: "cable",
    level: "新手到初中级",
    summary: "建立背阔发力路径最直观的基础动作之一。",
    prescription: "4 组 × 8-12 次",
    cues: ["先沉肩再拉", "拉杆靠近上胸", "避免后仰借力"],
    notes: ["适合作为拉训练日主动作"]
  },
  {
    id: "chest-supported-row",
    name: "胸托划船",
    primaryGroup: "背",
    secondaryGroup: "中背",
    targetMuscles: ["菱形肌", "斜方肌中下束", "背阔肌"],
    equipment: "固定器械",
    equipmentKey: "machine",
    level: "新手友好",
    summary: "躯干更稳定，适合把注意力放在中背夹紧感上。",
    prescription: "4 组 × 10-12 次",
    cues: ["肩胛先向后收", "肘部朝身体两侧划", "不要耸肩"],
    notes: ["适合和高位下拉配对安排"]
  },
  {
    id: "single-arm-dumbbell-row",
    name: "单臂哑铃划船",
    primaryGroup: "背",
    secondaryGroup: "大圆肌",
    targetMuscles: ["大圆肌", "背阔肌", "后束"],
    equipment: "哑铃",
    equipmentKey: "dumbbell",
    level: "初中级",
    summary: "单侧动作更适合修正左右发力差异。",
    prescription: "3 组 × 10-12 次",
    cues: ["脊柱保持中立", "手肘贴近躯干后拉", "下放到底感受拉伸"],
    notes: ["可配合凳子支撑降低腰部压力"]
  },
  {
    id: "straight-arm-pulldown",
    name: "直臂下压",
    primaryGroup: "背",
    secondaryGroup: "背阔肌",
    targetMuscles: ["背阔肌", "大圆肌"],
    equipment: "拉力器",
    equipmentKey: "cable",
    level: "新手友好",
    summary: "更容易找到背阔肌下压发力感，适合作为背感建立动作。",
    prescription: "3 组 × 12-15 次",
    cues: ["手臂保持微屈", "下压到大腿前侧", "躯干不要大幅晃动"],
    notes: ["适合拉日前置激活"]
  },
  {
    id: "romanian-deadlift",
    name: "罗马尼亚硬拉",
    primaryGroup: "腿",
    secondaryGroup: "股二头",
    targetMuscles: ["股二头肌", "臀大肌", "竖脊肌"],
    equipment: "杠铃",
    equipmentKey: "barbell",
    level: "中级",
    summary: "经典后链训练动作，适合提高髋主导力量。",
    prescription: "4 组 × 6-8 次",
    cues: ["髋向后坐", "杠铃贴腿下放", "保持脊柱中立"],
    notes: ["后链训练日优先动作"]
  },
  {
    id: "goblet-squat",
    name: "高脚杯深蹲",
    primaryGroup: "腿",
    secondaryGroup: "股四头",
    targetMuscles: ["股四头肌", "臀大肌", "核心"],
    equipment: "壶铃",
    equipmentKey: "kettlebell",
    level: "新手友好",
    summary: "学习深蹲轨迹和核心稳定非常高效的入门动作。",
    prescription: "4 组 × 10-12 次",
    cues: ["躯干立住再下蹲", "膝盖跟脚尖方向一致", "底部保持全脚掌受力"],
    notes: ["可作为深蹲模式热身或主动作"]
  },
  {
    id: "bulgarian-split-squat",
    name: "保加利亚分腿蹲",
    primaryGroup: "腿",
    secondaryGroup: "臀部",
    targetMuscles: ["臀大肌", "股四头肌", "股二头肌"],
    equipment: "哑铃",
    equipmentKey: "dumbbell",
    level: "初中级",
    summary: "单腿稳定与臀腿刺激兼顾，适合补足下肢左右差异。",
    prescription: "3 组 × 8-10 次 / 侧",
    cues: ["前脚站稳后再下放", "躯干微前倾", "底部膝髋同时弯曲"],
    notes: ["可放在下肢主动作之后"]
  },
  {
    id: "lying-leg-curl",
    name: "俯卧腿弯举",
    primaryGroup: "腿",
    secondaryGroup: "股二头",
    targetMuscles: ["股二头肌"],
    equipment: "固定器械",
    equipmentKey: "machine",
    level: "新手友好",
    summary: "更集中刺激腿后侧，适合作为后链补充动作。",
    prescription: "3 组 × 12-15 次",
    cues: ["髋部贴稳垫面", "上卷时脚踝放松", "离心阶段放慢"],
    notes: ["适合与硬拉类动作错位安排"]
  },
  {
    id: "walking-lunge",
    name: "行进箭步蹲",
    primaryGroup: "腿",
    secondaryGroup: "股四头",
    targetMuscles: ["股四头肌", "臀大肌", "核心"],
    equipment: "自重",
    equipmentKey: "bodyweight",
    level: "新手友好",
    summary: "更适合在训练后半段提高下肢代谢和单腿稳定。",
    prescription: "3 组 × 12 步 / 侧",
    cues: ["步幅稳定", "躯干保持直立", "前脚发力站起"],
    notes: ["也可以做热身激活"]
  },
  {
    id: "cable-crunch",
    name: "绳索卷腹",
    primaryGroup: "腹部",
    secondaryGroup: "上腹",
    targetMuscles: ["腹直肌上部"],
    equipment: "拉力器",
    equipmentKey: "cable",
    level: "新手友好",
    summary: "比普通卷腹更容易形成负重刺激。",
    prescription: "3 组 × 12-15 次",
    cues: ["骨盆保持相对固定", "胸骨朝骨盆卷动", "不要用手臂拉绳"],
    notes: ["适合作为力量训练后的腹部补充"]
  },
  {
    id: "hanging-knee-raise",
    name: "悬垂举膝",
    primaryGroup: "腹部",
    secondaryGroup: "下腹",
    targetMuscles: ["腹直肌下部", "髂腰肌"],
    equipment: "单杠",
    equipmentKey: "pullup_bar",
    level: "初中级",
    summary: "对下腹和骨盆控制要求更高，适合进阶核心训练。",
    prescription: "3 组 × 10-12 次",
    cues: ["先收骨盆再抬膝", "躯干尽量减少摆动", "下放有控制"],
    notes: ["如果摆动明显，可先改仰卧举腿"]
  },
  {
    id: "ab-wheel-rollout",
    name: "健腹轮 rollout",
    primaryGroup: "腹部",
    secondaryGroup: "核心稳定",
    targetMuscles: ["腹横肌", "腹直肌", "前锯肌"],
    equipment: "健腹轮",
    equipmentKey: "ab_wheel",
    level: "中级",
    summary: "更偏抗伸展能力训练，对核心整体稳定要求很高。",
    prescription: "3 组 × 8-10 次",
    cues: ["骨盆微后倾", "躯干整体向前伸展", "不要塌腰"],
    notes: ["建议安排在训练后半段"]
  },
  {
    id: "dead-bug",
    name: "Dead bug",
    primaryGroup: "腹部",
    secondaryGroup: "核心稳定",
    targetMuscles: ["腹横肌", "髂腰肌", "核心稳定"],
    equipment: "自重",
    equipmentKey: "bodyweight",
    level: "新手友好",
    summary: "对核心抗伸展和呼吸控制很友好，适合作为每日核心基础动作。",
    prescription: "3 组 × 10 次 / 侧",
    cues: ["腰背贴稳地面", "呼气时伸展", "动作范围不要牺牲稳定"],
    notes: ["适合作为训练前激活或训练后补充"]
  }
];

function getRecommendedIds(todayFocus: string) {
  const focus = todayFocus.toLowerCase();

  if (focus.includes("下肢") || focus.includes("lower")) {
    return ["goblet-squat", "romanian-deadlift", "bulgarian-split-squat", "lying-leg-curl"];
  }

  if (focus.includes("核心") || focus.includes("core")) {
    return ["dead-bug", "cable-crunch", "ab-wheel-rollout", "hanging-knee-raise"];
  }

  if (focus.includes("背") || focus.includes("pull")) {
    return ["lat-pulldown", "chest-supported-row", "single-arm-dumbbell-row", "face-pull"];
  }

  return [
    "incline-dumbbell-press",
    "lat-pulldown",
    "seated-dumbbell-press",
    "dead-bug"
  ];
}

export function ExerciseLibrary({ todayFocus }: { todayFocus: string }) {
  const [primaryGroup, setPrimaryGroup] = useState<string>("全部");
  const [secondaryGroup, setSecondaryGroup] = useState<string>("全部");
  const [equipmentKey, setEquipmentKey] = useState<string>("all");
  const [selectedExercise, setSelectedExercise] = useState<ExerciseCatalogItem | null>(null);

  const recommendedIds = useMemo(() => getRecommendedIds(todayFocus), [todayFocus]);
  const recommended = useMemo(
    () =>
      recommendedIds
        .map((id) => exerciseCatalog.find((item) => item.id === id))
        .filter((item): item is ExerciseCatalogItem => Boolean(item)),
    [recommendedIds]
  );

  const primaryGroups = useMemo(
    () => ["全部", ...Array.from(new Set(exerciseCatalog.map((item) => item.primaryGroup)))],
    []
  );

  const secondaryGroups = useMemo(() => {
    const source =
      primaryGroup === "全部"
        ? exerciseCatalog
        : exerciseCatalog.filter((item) => item.primaryGroup === primaryGroup);
    return ["全部", ...Array.from(new Set(source.map((item) => item.secondaryGroup)))];
  }, [primaryGroup]);

  useEffect(() => {
    if (!secondaryGroups.includes(secondaryGroup)) {
      setSecondaryGroup("全部");
    }
  }, [secondaryGroup, secondaryGroups]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedExercise(null);
      }
    }

    if (selectedExercise) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", onKeyDown);
      return () => {
        document.body.style.overflow = originalOverflow;
        window.removeEventListener("keydown", onKeyDown);
      };
    }
  }, [selectedExercise]);

  const filteredExercises = useMemo(() => {
    return exerciseCatalog.filter((item) => {
      const matchesPrimary = primaryGroup === "全部" || item.primaryGroup === primaryGroup;
      const matchesSecondary = secondaryGroup === "全部" || item.secondaryGroup === secondaryGroup;
      const matchesEquipment = equipmentKey === "all" || item.equipmentKey === equipmentKey;
      return matchesPrimary && matchesSecondary && matchesEquipment;
    });
  }, [equipmentKey, primaryGroup, secondaryGroup]);

  return (
    <>
      <div className="exercise-studio">
        <section className="exercise-recommend-strip">
          <div className="section-head">
            <div className="section-copy">
              <span className="section-label">Recommended</span>
              <h3>今日推荐动作</h3>
              <p className="muted">{todayFocus}</p>
            </div>
          </div>

          <div className="exercise-card-row">
            {recommended.map((exercise) => (
              <button
                key={exercise.id}
                type="button"
                className="exercise-mini-card recommended"
                onClick={() => setSelectedExercise(exercise)}
              >
                <ExerciseEquipmentIcon equipmentKey={exercise.equipmentKey} />
                <div className="exercise-mini-copy">
                  <strong>{exercise.name}</strong>
                  <span>
                    {exercise.primaryGroup} · {exercise.secondaryGroup}
                  </span>
                  <small>{exercise.equipment}</small>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="exercise-filter-panel">
          <div className="exercise-filter-head">
            <div className="section-copy">
              <span className="section-label">Library</span>
              <h3>动作检索</h3>
            </div>
            <span className="mini-chip">{filteredExercises.length} 个动作</span>
          </div>

          <div className="exercise-filter-stack">
            <div className="exercise-filter-group">
              <span className="metric-label">训练部位</span>
              <div className="exercise-filter-tabs">
                {primaryGroups.map((group) => (
                  <button
                    key={group}
                    type="button"
                    className={`exercise-filter-tab ${primaryGroup === group ? "active" : ""}`}
                    onClick={() => setPrimaryGroup(group)}
                  >
                    {group}
                  </button>
                ))}
              </div>
            </div>

            <div className="exercise-filter-group">
              <span className="metric-label">细分部位</span>
              <div className="exercise-filter-chips">
                {secondaryGroups.map((group) => (
                  <button
                    key={group}
                    type="button"
                    className={`exercise-filter-chip ${secondaryGroup === group ? "active" : ""}`}
                    onClick={() => setSecondaryGroup(group)}
                  >
                    {group}
                  </button>
                ))}
              </div>
            </div>

            <div className="exercise-filter-group">
              <span className="metric-label">训练器材</span>
              <div className="exercise-equipment-grid">
                <button
                  type="button"
                  className={`exercise-equipment-card ${equipmentKey === "all" ? "active" : ""}`}
                  onClick={() => setEquipmentKey("all")}
                >
                  <span className="exercise-equipment-icon all">ALL</span>
                  <small>全部</small>
                </button>
                {equipmentOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`exercise-equipment-card ${equipmentKey === option.key ? "active" : ""}`}
                    onClick={() => setEquipmentKey(option.key)}
                  >
                    <ExerciseEquipmentIcon equipmentKey={option.key} />
                    <small>{option.label}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="exercise-result-grid">
            {filteredExercises.map((exercise) => (
              <button
                key={exercise.id}
                type="button"
                className="exercise-mini-card"
                onClick={() => setSelectedExercise(exercise)}
              >
                <ExerciseEquipmentIcon equipmentKey={exercise.equipmentKey} />
                <div className="exercise-mini-copy">
                  <strong>{exercise.name}</strong>
                  <span>
                    {exercise.primaryGroup} · {exercise.secondaryGroup}
                  </span>
                  <small>{exercise.equipment}</small>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>

      {selectedExercise ? (
        <div className="exercise-modal-overlay" onClick={() => setSelectedExercise(null)} role="presentation">
          <div
            className="exercise-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exercise-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="exercise-modal-header">
              <div className="exercise-modal-title">
                <ExerciseEquipmentIcon equipmentKey={selectedExercise.equipmentKey} className="large" />
                <div>
                  <span className="section-label">{selectedExercise.equipment}</span>
                  <h3 id="exercise-modal-title">{selectedExercise.name}</h3>
                  <p className="muted">
                    {selectedExercise.primaryGroup} · {selectedExercise.secondaryGroup} · {selectedExercise.level}
                  </p>
                </div>
              </div>
              <button type="button" className="diet-icon-button" onClick={() => setSelectedExercise(null)} aria-label="关闭动作详情">
                ×
              </button>
            </div>

            <div className="exercise-modal-body">
              <section className="exercise-detail-overview">
                <div className="exercise-detail-copy">
                  <span className="section-label">Overview</span>
                  <p>{selectedExercise.summary}</p>
                </div>
                <div className="exercise-detail-kpis">
                  <div>
                    <span className="metric-label">推荐组数</span>
                    <strong>{selectedExercise.prescription}</strong>
                  </div>
                  <div>
                    <span className="metric-label">主要刺激</span>
                    <strong>{selectedExercise.targetMuscles.join(" · ")}</strong>
                  </div>
                </div>
              </section>

              <section className="exercise-detail-grid">
                <div className="exercise-detail-block">
                  <span className="section-label">Cues</span>
                  <div className="exercise-detail-list">
                    {selectedExercise.cues.map((cue) => (
                      <p key={cue}>{cue}</p>
                    ))}
                  </div>
                </div>

                <div className="exercise-detail-block">
                  <span className="section-label">Notes</span>
                  <div className="exercise-detail-list">
                    {selectedExercise.notes.map((note) => (
                      <p key={note}>{note}</p>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
