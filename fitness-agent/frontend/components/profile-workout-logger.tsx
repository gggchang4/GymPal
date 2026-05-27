"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createWorkoutLog } from "@/lib/api";
import type { FormEvent } from "react";
import type { WorkoutLog } from "@/lib/types";

const workoutTypeOptions = [
  ["strength", "力量训练"],
  ["cardio", "有氧训练"],
  ["mobility", "活动度训练"],
  ["mixed", "综合训练"]
] as const;

const intensityOptions = [
  ["low", "偏低"],
  ["moderate", "适中"],
  ["high", "较高"]
] as const;

const completionOptions = [
  ["completed", "已完成"],
  ["partial", "部分完成"],
  ["skipped", "未完成"]
] as const;

const fatigueOptions = [
  ["low", "偏低"],
  ["normal", "正常"],
  ["high", "较高"]
] as const;

function optionalString(value: FormDataEntryValue | null) {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || undefined;
}

function numberFromForm(value: FormDataEntryValue | null, fallback: number) {
  const raw = typeof value === "string" ? value.trim() : "";
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function ProfileWorkoutLogger() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setError(null);

    const formData = new FormData(form);
    const payload: Omit<WorkoutLog, "id" | "recordedAt"> = {
      workoutType: optionalString(formData.get("workoutType")) ?? "strength",
      durationMin: numberFromForm(formData.get("durationMin"), 45),
      intensity: optionalString(formData.get("intensity")) ?? "moderate",
      completion: optionalString(formData.get("completion")) ?? "completed",
      exerciseNote: optionalString(formData.get("exerciseNote")),
      painFeedback: optionalString(formData.get("painFeedback")),
      fatigueAfter: optionalString(formData.get("fatigueAfter"))
    };

    try {
      await createWorkoutLog(payload);
      setOpen(false);
      form.reset();
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "训练记录保存失败，请稍后再试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button className="ghost-button profile-edit-trigger" type="button" onClick={() => setOpen(true)}>
        记录训练
      </button>

      {open && mounted
        ? createPortal(
            <div className="profile-editor-overlay" role="presentation">
              <form className="profile-editor-panel profile-workout-panel" onSubmit={handleSubmit}>
                <div className="profile-editor-head">
                  <div>
                    <span className="section-label">Workout</span>
                    <h3>记录训练</h3>
                  </div>
                  <button className="ghost-button" type="button" onClick={() => setOpen(false)}>
                    关闭
                  </button>
                </div>

                <div className="profile-editor-grid">
                  <label className="field">
                    <span className="form-label">训练类型</span>
                    <select name="workoutType" defaultValue="strength">
                      {workoutTypeOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="form-label">训练时长 分钟</span>
                    <input name="durationMin" type="number" step="1" min="1" defaultValue="45" required />
                  </label>
                  <label className="field">
                    <span className="form-label">训练强度</span>
                    <select name="intensity" defaultValue="moderate">
                      {intensityOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="form-label">完成情况</span>
                    <select name="completion" defaultValue="completed">
                      {completionOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="form-label">训练后疲劳</span>
                    <select name="fatigueAfter" defaultValue="normal">
                      {fatigueOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field span-2">
                    <span className="form-label">训练备注</span>
                    <textarea name="exerciseNote" placeholder="例如：胸肩训练，卧推 4 组，状态不错" />
                  </label>
                  <label className="field span-2">
                    <span className="form-label">不适反馈</span>
                    <textarea name="painFeedback" placeholder="没有不适可以留空" />
                  </label>
                </div>

                {error ? <p className="profile-editor-error">{error}</p> : null}

                <div className="profile-editor-actions">
                  <button className="ghost-button" type="button" onClick={() => setOpen(false)}>
                    取消
                  </button>
                  <button className="button" type="submit" disabled={saving}>
                    {saving ? "保存中" : "保存训练"}
                  </button>
                </div>
              </form>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
