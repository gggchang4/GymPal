"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createBodyMetric, updateProfile } from "@/lib/api";
import type { FormEvent } from "react";
import type { HealthProfile } from "@/lib/types";

interface ProfileEditorProps {
  email: string;
  initialProfile: HealthProfile | null;
  latestWeightKg?: number | null;
}

const activityOptions = [
  ["", "未记录"],
  ["low", "偏低"],
  ["medium", "中等"],
  ["moderate", "适中"],
  ["high", "较高"]
] as const;

const genderOptions = [
  ["", "未记录"],
  ["male", "男"],
  ["female", "女"],
  ["other", "其他"]
] as const;

const experienceOptions = [
  ["", "未记录"],
  ["novice", "新手"],
  ["intermediate", "进阶"],
  ["advanced", "高级"]
] as const;

const equipmentOptions = [
  ["", "未记录"],
  ["commercial_gym", "商业健身房"],
  ["home_gym", "家庭器械"],
  ["bodyweight_only", "徒手训练"]
] as const;

function numberValue(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function optionalNumber(value: FormDataEntryValue | null) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalString(value: FormDataEntryValue | null) {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || undefined;
}

function hasWeightChanged(nextWeight: number | undefined, previousWeight?: number | null) {
  if (nextWeight === undefined) {
    return false;
  }

  if (previousWeight === undefined || previousWeight === null || !Number.isFinite(previousWeight)) {
    return true;
  }

  return Math.abs(nextWeight - previousWeight) >= 0.05;
}

export function ProfileEditor({ email, initialProfile, latestWeightKg }: ProfileEditorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const defaults = useMemo(
    () => ({
      age: numberValue(initialProfile?.age),
      heightCm: numberValue(initialProfile?.heightCm),
      currentWeightKg: numberValue(initialProfile?.currentWeightKg ?? latestWeightKg),
      targetWeightKg: numberValue(initialProfile?.targetWeightKg ?? latestWeightKg),
      trainingDaysPerWeek: numberValue(initialProfile?.trainingDaysPerWeek ?? 4),
      activityLevel: initialProfile?.activityLevel ?? "",
      gender: initialProfile?.gender ?? "",
      trainingExperience: initialProfile?.trainingExperience ?? "",
      equipmentAccess: initialProfile?.equipmentAccess ?? "",
      limitations: initialProfile?.limitations ?? ""
    }),
    [initialProfile, latestWeightKg]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const payload: Partial<HealthProfile> = {
      age: optionalNumber(formData.get("age")),
      heightCm: optionalNumber(formData.get("heightCm")),
      currentWeightKg: optionalNumber(formData.get("currentWeightKg")),
      targetWeightKg: optionalNumber(formData.get("targetWeightKg")),
      trainingDaysPerWeek: optionalNumber(formData.get("trainingDaysPerWeek")),
      activityLevel: optionalString(formData.get("activityLevel")),
      gender: optionalString(formData.get("gender")),
      trainingExperience: optionalString(formData.get("trainingExperience")),
      equipmentAccess: optionalString(formData.get("equipmentAccess")),
      limitations: optionalString(formData.get("limitations"))
    };

    try {
      await updateProfile(payload);
      if (hasWeightChanged(payload.currentWeightKg, initialProfile?.currentWeightKg ?? latestWeightKg)) {
        await createBodyMetric({ weightKg: payload.currentWeightKg! });
      }
      setOpen(false);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存失败，请稍后再试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button className="button profile-edit-trigger" type="button" onClick={() => setOpen(true)}>
        编辑资料
      </button>

      {open && mounted
        ? createPortal(
        <div className="profile-editor-overlay" role="presentation">
          <form className="profile-editor-panel" onSubmit={handleSubmit}>
            <div className="profile-editor-head">
              <div>
                <span className="section-label">Profile</span>
                <h3>修改档案</h3>
                <p className="muted">邮箱 {email}</p>
              </div>
              <button className="ghost-button" type="button" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>

            <div className="profile-editor-grid">
              <label className="field">
                <span className="form-label">当前体重 kg</span>
                <input name="currentWeightKg" type="number" step="0.1" min="0" defaultValue={defaults.currentWeightKg} />
              </label>
              <label className="field">
                <span className="form-label">目标体重 kg</span>
                <input name="targetWeightKg" type="number" step="0.1" min="0" defaultValue={defaults.targetWeightKg} />
              </label>
              <label className="field">
                <span className="form-label">身高 cm</span>
                <input name="heightCm" type="number" step="0.1" min="0" defaultValue={defaults.heightCm} />
              </label>
              <label className="field">
                <span className="form-label">年龄</span>
                <input name="age" type="number" step="1" min="0" defaultValue={defaults.age} />
              </label>
              <label className="field">
                <span className="form-label">每周训练次数</span>
                <input
                  name="trainingDaysPerWeek"
                  type="number"
                  step="1"
                  min="0"
                  max="7"
                  defaultValue={defaults.trainingDaysPerWeek}
                />
              </label>
              <label className="field">
                <span className="form-label">活动水平</span>
                <select name="activityLevel" defaultValue={defaults.activityLevel}>
                  {activityOptions.map(([value, label]) => (
                    <option key={value || "empty"} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="form-label">性别</span>
                <select name="gender" defaultValue={defaults.gender}>
                  {genderOptions.map(([value, label]) => (
                    <option key={value || "empty"} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="form-label">训练经验</span>
                <select name="trainingExperience" defaultValue={defaults.trainingExperience}>
                  {experienceOptions.map(([value, label]) => (
                    <option key={value || "empty"} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="form-label">器械条件</span>
                <select name="equipmentAccess" defaultValue={defaults.equipmentAccess}>
                  {equipmentOptions.map(([value, label]) => (
                    <option key={value || "empty"} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field span-2">
                <span className="form-label">限制说明</span>
                <textarea name="limitations" defaultValue={defaults.limitations} />
              </label>
            </div>

            {error ? <p className="profile-editor-error">{error}</p> : null}

            <div className="profile-editor-actions">
              <button className="ghost-button" type="button" onClick={() => setOpen(false)}>
                取消
              </button>
              <button className="button" type="submit" disabled={saving}>
                {saving ? "保存中" : "保存修改"}
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
