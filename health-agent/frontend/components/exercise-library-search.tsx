"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ExerciseEquipmentIcon } from "@/components/exercise-equipment-icon";
import {
  buildEquipmentOptions,
  getRecommendedExercises,
  type ExerciseCatalogItem
} from "@/lib/exercise-catalog";

export function ExerciseLibrarySearch({
  catalog,
  todayFocus
}: {
  catalog: ExerciseCatalogItem[];
  todayFocus: string;
}) {
  const [query, setQuery] = useState("");
  const [primaryGroup, setPrimaryGroup] = useState("全部");
  const [secondaryGroup, setSecondaryGroup] = useState("全部");
  const [equipmentKey, setEquipmentKey] = useState("all");
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedExercise, setSelectedExercise] = useState<ExerciseCatalogItem | null>(null);

  const recommended = useMemo(
    () => getRecommendedExercises(catalog, todayFocus),
    [catalog, todayFocus]
  );
  const equipmentOptions = useMemo(() => buildEquipmentOptions(catalog), [catalog]);

  const primaryGroups = useMemo(
    () => ["全部", ...Array.from(new Set(catalog.map((item) => item.primaryGroup)))],
    [catalog]
  );

  const secondaryGroups = useMemo(() => {
    const source =
      primaryGroup === "全部"
        ? catalog
        : catalog.filter((item) => item.primaryGroup === primaryGroup);

    return ["全部", ...Array.from(new Set(source.map((item) => item.secondaryGroup)))];
  }, [catalog, primaryGroup]);

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
    const normalizedQuery = query.trim().toLowerCase();

    return catalog.filter((item) => {
      const matchesPrimary = primaryGroup === "全部" || item.primaryGroup === primaryGroup;
      const matchesSecondary = secondaryGroup === "全部" || item.secondaryGroup === secondaryGroup;
      const matchesEquipment = equipmentKey === "all" || item.equipmentKey === equipmentKey;
      const matchesQuery = !normalizedQuery || item.searchText.includes(normalizedQuery);

      return matchesPrimary && matchesSecondary && matchesEquipment && matchesQuery;
    });
  }, [catalog, equipmentKey, primaryGroup, query, secondaryGroup]);

  const hasActiveCriteria =
    query.trim().length > 0 ||
    primaryGroup !== "全部" ||
    secondaryGroup !== "全部" ||
    equipmentKey !== "all";

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHasSearched(hasActiveCriteria);
  };

  const handleReset = () => {
    setQuery("");
    setPrimaryGroup("全部");
    setSecondaryGroup("全部");
    setEquipmentKey("all");
    setHasSearched(false);
  };

  return (
    <>
      <div className="exercise-library-shell">
        <section className="exercise-recommend-strip refined">
          <div className="exercise-search-head compact">
            <div className="section-copy">
              <span className="section-label">Recommended</span>
              <h3>今日推荐</h3>
            </div>
            <span className="mini-chip">{todayFocus}</span>
          </div>

          <div className="exercise-card-row">
            {recommended.map((exercise) => (
              <button
                key={exercise.id}
                type="button"
                className="exercise-mini-card recommended"
                onClick={() => setSelectedExercise(exercise)}
              >
                <ExerciseEquipmentIcon equipmentKey={exercise.equipmentKey ?? "accessory"} />
                <div className="exercise-mini-copy">
                  <strong>{exercise.name}</strong>
                  <span>
                    {exercise.primaryGroup} / {exercise.equipment}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="exercise-search-lab">
          <div className="exercise-search-head compact">
            <div className="section-copy">
              <span className="section-label">Search</span>
              <h3>检索动作库</h3>
            </div>
            <span className="mini-chip">{hasSearched ? `${filteredExercises.length} 个结果` : "未搜索"}</span>
          </div>

          <form className="exercise-search-form" onSubmit={handleSearch}>
            <label className="exercise-query-field">
              <span className="form-label">关键词</span>
              <input
                value={query}
                placeholder="动作名、部位、器材、难度都可以检索"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <div className="exercise-search-grid">
              <label className="exercise-select-field">
                <span className="form-label">训练部位</span>
                <select value={primaryGroup} onChange={(event) => setPrimaryGroup(event.target.value)}>
                  {primaryGroups.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </label>

              <label className="exercise-select-field">
                <span className="form-label">细分部位</span>
                <select
                  value={secondaryGroup}
                  onChange={(event) => setSecondaryGroup(event.target.value)}
                >
                  {secondaryGroups.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </label>

              <label className="exercise-select-field">
                <span className="form-label">训练器材</span>
                <select value={equipmentKey} onChange={(event) => setEquipmentKey(event.target.value)}>
                  <option value="all">全部器材</option>
                  {equipmentOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="exercise-search-actions">
              <button type="submit" className="button" disabled={!hasActiveCriteria}>
                开始检索
              </button>
              <button type="button" className="ghost-button" onClick={handleReset}>
                清空
              </button>
            </div>
          </form>
        </section>

        {hasSearched ? (
          <section className="exercise-results-shell">
            {filteredExercises.length === 0 ? (
              <div className="exercise-results-empty">
                <span className="section-label">No results</span>
                <h3>没有找到匹配动作</h3>
                <p className="muted">试着换个关键词，或者放宽部位和器材筛选条件。</p>
              </div>
            ) : (
              <>
                <div className="exercise-results-head">
                  <div className="section-copy">
                    <span className="section-label">Results</span>
                    <h3>检索结果</h3>
                  </div>
                  <span className="mini-chip">{filteredExercises.length} 个动作</span>
                </div>

                <div className="exercise-result-grid">
                  {filteredExercises.map((exercise) => (
                    <button
                      key={exercise.id}
                      type="button"
                      className="exercise-mini-card"
                      onClick={() => setSelectedExercise(exercise)}
                    >
                      <ExerciseEquipmentIcon equipmentKey={exercise.equipmentKey ?? "accessory"} />
                      <div className="exercise-mini-copy">
                        <strong>{exercise.name}</strong>
                        <span>
                          {exercise.primaryGroup} / {exercise.equipment}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        ) : null}
      </div>

      {selectedExercise ? (
        <div
          className="exercise-modal-overlay"
          onClick={() => setSelectedExercise(null)}
          role="presentation"
        >
          <div
            className="exercise-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exercise-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="exercise-modal-header">
              <div className="exercise-modal-title">
                <ExerciseEquipmentIcon
                  equipmentKey={selectedExercise.equipmentKey ?? "accessory"}
                  className="large"
                />
                <div>
                  <span className="section-label">{selectedExercise.equipment}</span>
                  <h3 id="exercise-modal-title">{selectedExercise.name}</h3>
                  <p className="muted">
                    {selectedExercise.primaryGroup} / {selectedExercise.secondaryGroup} /{" "}
                    {selectedExercise.level}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="diet-icon-button"
                onClick={() => setSelectedExercise(null)}
                aria-label="关闭动作详情"
              >
                x
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
                    <span className="metric-label">推荐训练量</span>
                    <strong>{selectedExercise.prescription ?? "按计划安排"}</strong>
                  </div>
                  <div>
                    <span className="metric-label">主要刺激</span>
                    <strong>{selectedExercise.targetMuscles.join(" / ")}</strong>
                  </div>
                </div>
              </section>

              <section className="exercise-detail-grid">
                <div className="exercise-detail-block">
                  <span className="section-label">Cues</span>
                  <div className="exercise-detail-list">
                    {(selectedExercise.cues ?? []).map((cue) => (
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
