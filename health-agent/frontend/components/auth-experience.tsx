"use client";

import type { CSSProperties, RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, startTransition, useEffect, useRef, useState } from "react";
import { ActivityRings } from "@/components/activity-rings";
import {
  authAdapter,
  type AuthMode,
  type LoginPayload,
  type RegisterPayload
} from "@/lib/auth";
import { appRoutes } from "@/lib/routes";
import { storeRouteTransition } from "@/lib/route-transition";

interface RegisterFormState extends RegisterPayload {
  confirmPassword: string;
}

interface ProgressRing {
  key: "move" | "load" | "focus";
  label: string;
  value: number;
  note: string;
  accent: string;
}

type SuccessPhase = "idle" | "settling" | "centering" | "routing";

const dashboardRingAccents = ["#d53832", "#20202a", "#8f9199"] as const;
const authRouteTarget = appRoutes.chat;
const authRouteOrbitRadius = 88;
const authRouteOrbitCircumference = 2 * Math.PI * authRouteOrbitRadius;
const authRouteSettleDelayMs = 120;
const authRouteCenteringDurationMs = 820;
const authRouteRoutingDelayMs = authRouteSettleDelayMs + authRouteCenteringDurationMs + 20;
const authRouteRedirectDelayMs = 1480;

interface AuthRouteMetrics {
  originX: number;
  originY: number;
  originScale: number;
  targetSize: number;
}

const goalOptions = [
  { value: "fat_loss", label: "减脂" },
  { value: "muscle_gain", label: "增肌" },
  { value: "athletic", label: "体能" }
] as const;

const trainingDayOptions = [
  { value: "2", label: "每周 2 天" },
  { value: "3", label: "每周 3 天" },
  { value: "4", label: "每周 4 天" },
  { value: "5", label: "每周 5 天" }
] as const;

const loginDemoValues: LoginPayload = {
  email: "demo@gympal.ai",
  password: "gympal123",
  remember: true
};

const registerDemoValues: RegisterFormState = {
  name: "Alex Chen",
  email: "alex@gympal.ai",
  password: "gympal123",
  confirmPassword: "gympal123",
  goal: "fat_loss",
  trainingDays: "4",
  remember: true
};

const modeCopy = {
  login: {
    title: "欢迎回来",
    description: "继续今天的训练节奏。",
    submitLabel: "登录",
    demoLabel: "填入演示账号",
    helper: "demo@gympal.ai / gympal123",
    success: "登录完成，正在进入训练主页。"
  },
  register: {
    title: "创建账号",
    description: "设置目标后即可开始。",
    submitLabel: "注册",
    demoLabel: "填入示例资料",
    helper: "只保留开始训练所需的关键信息。",
    success: "注册完成，正在进入训练主页。"
  }
} as const;

const ringMeaningCopy = "三层圆环会同步显示表单完成进度。";

function createEmptyLoginState(): LoginPayload {
  return {
    email: "",
    password: "",
    remember: true
  };
}

function createEmptyRegisterState(): RegisterFormState {
  return {
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    goal: "",
    trainingDays: "",
    remember: true
  };
}

function isFilled(value: string) {
  return value.trim().length > 0;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function AuthExperience({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const ringAnchorRef = useRef<HTMLDivElement | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const routeAnimationTimerRef = useRef<number | null>(null);
  const redirectTimerRef = useRef<number | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successPhase, setSuccessPhase] = useState<SuccessPhase>("idle");
  const [routeMetrics, setRouteMetrics] = useState<AuthRouteMetrics | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [loginForm, setLoginForm] = useState<LoginPayload>(createEmptyLoginState());
  const [registerForm, setRegisterForm] = useState<RegisterFormState>(createEmptyRegisterState());

  useEffect(() => {
    router.prefetch(authRouteTarget);
  }, [router]);

  useEffect(() => {
    setErrorMessage("");
    setIsSubmitting(false);
    setSuccessPhase("idle");
    setRouteMetrics(null);
    setLoginForm(createEmptyLoginState());
    setRegisterForm(createEmptyRegisterState());
  }, [mode]);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) {
        window.clearTimeout(settleTimerRef.current);
      }
      if (routeAnimationTimerRef.current) {
        window.clearTimeout(routeAnimationTimerRef.current);
      }
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  const completedFields =
    mode === "login"
      ? Number(isFilled(loginForm.email)) + Number(isFilled(loginForm.password))
      : Number(isFilled(registerForm.name)) +
        Number(isFilled(registerForm.email)) +
        Number(isFilled(registerForm.password)) +
        Number(isFilled(registerForm.confirmPassword)) +
        Number(isFilled(registerForm.goal)) +
        Number(isFilled(registerForm.trainingDays));

  const totalFields = mode === "login" ? 2 : 6;
  const completionValue = clampPercent((completedFields / totalFields) * 100);

  const passwordsAligned =
    mode === "register" &&
    isFilled(registerForm.password) &&
    registerForm.password === registerForm.confirmPassword;

  const canSubmit =
    mode === "login"
      ? isFilled(loginForm.email) && isFilled(loginForm.password)
      : isFilled(registerForm.name) &&
        isFilled(registerForm.email) &&
        isFilled(registerForm.password) &&
        isFilled(registerForm.confirmPassword) &&
        isFilled(registerForm.goal) &&
        isFilled(registerForm.trainingDays) &&
        registerForm.password.trim().length >= 6 &&
        passwordsAligned;

  const unifiedRingValue = successPhase !== "idle" ? 100 : completionValue;

  const progressRings: ProgressRing[] = [
    {
      key: "move",
      label: "Move",
      value: unifiedRingValue,
      note: `已完成 ${completedFields}/${totalFields} 项`,
      accent: dashboardRingAccents[0]
    },
    {
      key: "load",
      label: "Load",
      value: unifiedRingValue,
      note: `已完成 ${completedFields}/${totalFields} 项`,
      accent: dashboardRingAccents[1]
    },
    {
      key: "focus",
      label: "Focus",
      value: unifiedRingValue,
      note: `已完成 ${completedFields}/${totalFields} 项`,
      accent: dashboardRingAccents[2]
    }
  ];

  const isTransitioning = successPhase !== "idle";
  const helperText =
    successPhase !== "idle" ? modeCopy[mode].success : errorMessage || modeCopy[mode].helper;

  const captureRouteMetrics = (): AuthRouteMetrics => {
    const targetSize = Math.min(window.innerWidth < 820 ? 220 : 248, window.innerWidth * 0.62);
    const measuredElement =
      ringAnchorRef.current?.querySelector<HTMLElement>(".fitness-ring") ??
      ringAnchorRef.current?.querySelector<HTMLElement>(".ring-cluster") ??
      ringAnchorRef.current;

    if (!measuredElement) {
      return {
        originX: 0,
        originY: 0,
        originScale: 1,
        targetSize
      };
    }

    const bounds = measuredElement.getBoundingClientRect();
    const measuredSize = Math.min(bounds.width, bounds.height);

    return {
      originX: bounds.left + bounds.width / 2 - window.innerWidth / 2,
      originY: bounds.top + bounds.height / 2 - window.innerHeight / 2,
      originScale: Math.min(1.42, Math.max(0.82, measuredSize / targetSize)),
      targetSize
    };
  };

  const beginSuccessTransition = () => {
    const metrics = captureRouteMetrics();

    setErrorMessage("");
    setSuccessPhase("settling");
    setRouteMetrics(metrics);

    if (settleTimerRef.current) {
      window.clearTimeout(settleTimerRef.current);
    }
    if (routeAnimationTimerRef.current) {
      window.clearTimeout(routeAnimationTimerRef.current);
    }
    if (redirectTimerRef.current) {
      window.clearTimeout(redirectTimerRef.current);
    }

    settleTimerRef.current = window.setTimeout(
      () => setSuccessPhase("centering"),
      authRouteSettleDelayMs
    );
    routeAnimationTimerRef.current = window.setTimeout(
      () => setSuccessPhase("routing"),
      authRouteRoutingDelayMs
    );
    redirectTimerRef.current = window.setTimeout(() => {
      storeRouteTransition({
        source: "auth",
        target: authRouteTarget,
        at: Date.now(),
        style: "activity-ring",
        orbitSize: metrics.targetSize
      });
      startTransition(() => router.push(authRouteTarget));
    }, authRouteRedirectDelayMs);
  };

  const fillDemoValues = () => {
    setErrorMessage("");

    if (mode === "login") {
      setLoginForm({ ...loginDemoValues });
      return;
    }

    setRegisterForm({ ...registerDemoValues });
  };

  const submitLogin = async () => {
    const email = loginForm.email.trim();
    const password = loginForm.password.trim();

    if (!email || !password) {
      setErrorMessage("请输入邮箱和密码。");
      return false;
    }

    const result = await authAdapter.login({
      email,
      password,
      remember: loginForm.remember
    });

    if (!result.ok) {
      setErrorMessage(result.message);
      return false;
    }

    beginSuccessTransition();
    return true;
  };

  const submitRegister = async () => {
    const name = registerForm.name.trim();
    const email = registerForm.email.trim();
    const password = registerForm.password.trim();
    const confirmPassword = registerForm.confirmPassword.trim();

    if (!name || !email || !password || !confirmPassword) {
      setErrorMessage("请填写完整信息。");
      return false;
    }

    if (!registerForm.goal || !registerForm.trainingDays) {
      setErrorMessage("请选择训练目标和每周训练频次。");
      return false;
    }

    if (password.length < 6) {
      setErrorMessage("密码至少需要 6 位。");
      return false;
    }

    if (password !== confirmPassword) {
      setErrorMessage("两次输入的密码不一致。");
      return false;
    }

    const result = await authAdapter.register({
      name,
      email,
      password,
      goal: registerForm.goal,
      trainingDays: registerForm.trainingDays,
      remember: registerForm.remember
    });

    if (!result.ok) {
      setErrorMessage(result.message);
      return false;
    }

    beginSuccessTransition();
    return true;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    let didSucceed = false;

    try {
      didSucceed = mode === "login" ? await submitLogin() : await submitRegister();
    } finally {
      if (!didSucceed) {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div
      className={[
        "auth-stage",
        `auth-mode-${mode}`,
        isTransitioning ? "is-transitioning" : "",
        successPhase === "settling" ? "is-settling" : "",
        successPhase === "centering" ? "is-centering" : "",
        successPhase === "routing" ? "is-routing" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <section className="auth-shell">
        <div className="auth-switcher" aria-label="认证路由">
          <Link href={appRoutes.login} className={`auth-switch-link ${mode === "login" ? "active" : ""}`}>
            登录
          </Link>
          <Link
            href={appRoutes.register}
            className={`auth-switch-link ${mode === "register" ? "active" : ""}`}
          >
            注册
          </Link>
        </div>

        <div className="auth-layout">
          <div className="auth-form-panel">
            <div className="auth-copy">
              <span className="page-eyebrow">GymPal</span>
              <h1>{modeCopy[mode].title}</h1>
              <p>{modeCopy[mode].description}</p>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              {mode === "register" ? (
                <label className="field auth-field">
                  <span className="form-label">昵称</span>
                  <input
                    autoComplete="name"
                    value={registerForm.name}
                    placeholder="Alex Chen"
                    onChange={(event) =>
                      setRegisterForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </label>
              ) : null}

              <label className="field auth-field">
                <span className="form-label">邮箱</span>
                <input
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  value={mode === "login" ? loginForm.email : registerForm.email}
                  placeholder="you@gympal.ai"
                  onChange={(event) =>
                    mode === "login"
                      ? setLoginForm((current) => ({ ...current, email: event.target.value }))
                      : setRegisterForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </label>

              <label className="field auth-field">
                <span className="form-label">密码</span>
                <input
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={mode === "login" ? loginForm.password : registerForm.password}
                  placeholder="输入密码"
                  onChange={(event) =>
                    mode === "login"
                      ? setLoginForm((current) => ({ ...current, password: event.target.value }))
                      : setRegisterForm((current) => ({ ...current, password: event.target.value }))
                  }
                />
              </label>

              {mode === "register" ? (
                <>
                  <label className="field auth-field">
                    <span className="form-label">确认密码</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={registerForm.confirmPassword}
                      placeholder="再次输入密码"
                      onChange={(event) =>
                        setRegisterForm((current) => ({
                          ...current,
                          confirmPassword: event.target.value
                        }))
                      }
                    />
                  </label>

                  <div className="auth-choice-group">
                    <span className="form-label">训练目标</span>
                    <div className="auth-chip-row">
                      {goalOptions.map((goal) => (
                        <button
                          key={goal.value}
                          type="button"
                          className={`auth-choice-chip ${registerForm.goal === goal.value ? "active" : ""}`}
                          onClick={() =>
                            setRegisterForm((current) => ({ ...current, goal: goal.value }))
                          }
                        >
                          {goal.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="auth-choice-group">
                    <span className="form-label">每周训练</span>
                    <div className="auth-chip-row">
                      {trainingDayOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`auth-choice-chip ${registerForm.trainingDays === option.value ? "active" : ""}`}
                          onClick={() =>
                            setRegisterForm((current) => ({
                              ...current,
                              trainingDays: option.value
                            }))
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}

              <label className="auth-check-row">
                <input
                  type="checkbox"
                  checked={
                    mode === "login"
                      ? Boolean(loginForm.remember)
                      : Boolean(registerForm.remember)
                  }
                  onChange={(event) =>
                    mode === "login"
                      ? setLoginForm((current) => ({
                          ...current,
                          remember: event.target.checked
                        }))
                      : setRegisterForm((current) => ({
                          ...current,
                          remember: event.target.checked
                        }))
                  }
                />
                <span>保持登录</span>
              </label>

              <p className={`auth-helper ${errorMessage ? "is-error" : ""}`} aria-live="polite">
                {helperText}
              </p>

              <div className="auth-actions">
                <button
                  className="button auth-primary-button"
                  type="submit"
                  disabled={isSubmitting || isTransitioning || !canSubmit}
                >
                  {isSubmitting ? "处理中..." : modeCopy[mode].submitLabel}
                </button>
                <button
                  className="ghost-button auth-secondary-button"
                  type="button"
                  onClick={fillDemoValues}
                  disabled={isSubmitting || isTransitioning}
                >
                  {modeCopy[mode].demoLabel}
                </button>
              </div>
            </form>
          </div>

          <AuthRingCluster
            ringAnchorRef={ringAnchorRef}
            progressRings={progressRings}
            successPhase={successPhase}
          />
        </div>
      </section>

      <AuthRouteOrbitOverlay successPhase={successPhase} routeMetrics={routeMetrics} />
    </div>
  );
}

function AuthRingCluster({
  ringAnchorRef,
  progressRings,
  successPhase
}: {
  ringAnchorRef: RefObject<HTMLDivElement>;
  progressRings: ProgressRing[];
  successPhase: SuccessPhase;
}) {
  const activeRingSlug: ProgressRing["key"] = "move";

  const activityRings = progressRings.map((ring) => ({
    slug: ring.key,
    label: ring.label,
    value: ring.value,
    note: ring.note,
    accent: ring.accent
  }));

  return (
    <aside className={`auth-ring-panel ${successPhase !== "idle" ? "is-transitioning" : ""}`}>
      <div className="auth-ring-stage" ref={ringAnchorRef}>
        <ActivityRings rings={activityRings} activeSlug={activeRingSlug} lockActiveSlug />
      </div>
      <div className="auth-ring-meaning" aria-label="圆环进度说明">
        <div className="auth-ring-meaning-item compact">
          <span
            className="auth-ring-meaning-dot"
            style={{ backgroundColor: dashboardRingAccents[0] }}
          />
          <small>{ringMeaningCopy}</small>
        </div>
      </div>
    </aside>
  );
}

function AuthRouteOrbitOverlay({
  successPhase,
  routeMetrics
}: {
  successPhase: SuccessPhase;
  routeMetrics: AuthRouteMetrics | null;
}) {
  if (successPhase === "idle") {
    return null;
  }

  const orbitStyle =
    routeMetrics !== null
      ? ({
          "--auth-route-origin-x": `${routeMetrics.originX}px`,
          "--auth-route-origin-y": `${routeMetrics.originY}px`,
          "--auth-route-origin-scale": routeMetrics.originScale,
          "--auth-route-target-size": `${routeMetrics.targetSize}px`,
          "--auth-route-orbit-circumference": authRouteOrbitCircumference
        } as CSSProperties)
      : undefined;

  return (
    <div className="auth-route-layer" aria-hidden="true">
      <div className="auth-route-backdrop" />
      <div className="auth-route-orbit-shell" style={orbitStyle}>
        <div className="auth-route-orbit-glow" />
        <svg viewBox="0 0 220 220" className="auth-route-orbit-svg" role="presentation">
          <circle
            className="auth-route-orbit-track"
            cx="110"
            cy="110"
            r={authRouteOrbitRadius}
          />
          <circle
            className="auth-route-orbit-progress"
            cx="110"
            cy="110"
            r={authRouteOrbitRadius}
            stroke={dashboardRingAccents[0]}
            strokeDasharray={authRouteOrbitCircumference}
          />
        </svg>
      </div>
    </div>
  );
}
