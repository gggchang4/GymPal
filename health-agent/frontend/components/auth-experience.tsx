"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  authAdapter,
  type AuthMode,
  type LoginPayload,
  type RegisterPayload
} from "@/lib/auth";

const goalOptions = [
  {
    value: "fat_loss",
    label: "减脂"
  },
  {
    value: "muscle_gain",
    label: "增肌"
  },
  {
    value: "athletic",
    label: "体能"
  }
] as const;

const trainingDayOptions = [
  { value: "2", label: "每周 2 天" },
  { value: "3", label: "每周 3 天" },
  { value: "4", label: "每周 4 天" },
  { value: "5", label: "每周 5 天" }
] as const;

const registerStarter: RegisterPayload & { confirmPassword: string } = {
  name: "Alex Chen",
  email: "alex@gympal.ai",
  password: "gympal123",
  confirmPassword: "gympal123",
  goal: goalOptions[0].value,
  trainingDays: "4",
  remember: true
};

const loginStarter: LoginPayload = {
  email: "demo@gympal.ai",
  password: "gympal123",
  remember: true
};

export function AuthExperience({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const redirectTimerRef = useRef<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    mode === "login" ? "使用演示账号即可体验登录流程。" : "纯前端实现，接口结构已预留。"
  );
  const [loginForm, setLoginForm] = useState<LoginPayload>(loginStarter);
  const [registerForm, setRegisterForm] = useState(registerStarter);

  useEffect(() => {
    setErrorMessage("");
    setStatusMessage(
      mode === "login" ? "使用演示账号即可体验登录流程。" : "纯前端实现，接口结构已预留。"
    );
  }, [mode]);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  const helperText = errorMessage
    ? errorMessage
    : mode === "login"
      ? "默认演示账号：demo@gympal.ai / gympal123"
      : "注册成功后会直接进入 GymPal。";

  const handleLoginFieldChange = (key: keyof LoginPayload, value: string | boolean) => {
    setLoginForm((current) => ({ ...current, [key]: value }));
  };

  const handleRegisterFieldChange = (
    key: keyof (RegisterPayload & { confirmPassword: string }),
    value: string | boolean
  ) => {
    setRegisterForm((current) => ({ ...current, [key]: value }));
  };

  const fillStarterValues = () => {
    setErrorMessage("");

    if (mode === "login") {
      setLoginForm(loginStarter);
      setStatusMessage("已填入演示账号。");
      return;
    }

    setRegisterForm(registerStarter);
    setStatusMessage("已填入示例资料。");
  };

  const submitLogin = async () => {
    const email = loginForm.email.trim();
    const password = loginForm.password.trim();

    if (!email || !password) {
      setErrorMessage("请输入邮箱和密码。");
      return;
    }

    const result = await authAdapter.login({
      email,
      password,
      remember: loginForm.remember
    });

    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }

    setStatusMessage("登录成功，正在跳转。");
    if (redirectTimerRef.current) {
      window.clearTimeout(redirectTimerRef.current);
    }
    redirectTimerRef.current = window.setTimeout(() => router.push("/chat"), 700);
  };

  const submitRegister = async () => {
    const name = registerForm.name.trim();
    const email = registerForm.email.trim();
    const password = registerForm.password.trim();
    const confirmPassword = registerForm.confirmPassword.trim();

    if (!name || !email || !password || !confirmPassword) {
      setErrorMessage("请填写完整信息。");
      return;
    }

    if (password.length < 6) {
      setErrorMessage("密码至少需要 6 位。");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("两次输入的密码不一致。");
      return;
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
      return;
    }

    setStatusMessage("注册成功，正在进入 GymPal。");
    if (redirectTimerRef.current) {
      window.clearTimeout(redirectTimerRef.current);
    }
    redirectTimerRef.current = window.setTimeout(() => router.push("/chat"), 850);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      if (mode === "login") {
        await submitLogin();
      } else {
        await submitRegister();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`auth-basic auth-mode-${mode}`}>
      <section className="auth-basic-panel">
        <div className="auth-basic-copy centered">
          <span className="page-eyebrow">GymPal</span>
          <h1>{mode === "login" ? "欢迎回来" : "创建账号"}</h1>
          <p>{mode === "login" ? "继续今天的训练节奏。" : "从一个干净的起点开始。"}</p>
        </div>

        <div className="auth-form-top">
          <div className="auth-route-switch" aria-label="Authentication routes">
            <Link href="/login" className={`auth-route-link ${mode === "login" ? "active" : ""}`}>
              登录
            </Link>
            <Link
              href="/register"
              className={`auth-route-link ${mode === "register" ? "active" : ""}`}
            >
              注册
            </Link>
          </div>
        </div>

        <form className="auth-form-stack basic" onSubmit={handleSubmit}>
          {mode === "register" ? (
            <label className="field auth-field-shell">
              <span className="form-label">昵称</span>
              <input
                value={registerForm.name}
                placeholder="Alex Chen"
                onChange={(event) => handleRegisterFieldChange("name", event.target.value)}
              />
            </label>
          ) : null}

          <label className="field auth-field-shell">
            <span className="form-label">邮箱</span>
            <input
              value={mode === "login" ? loginForm.email : registerForm.email}
              placeholder="you@gympal.ai"
              onChange={(event) =>
                mode === "login"
                  ? handleLoginFieldChange("email", event.target.value)
                  : handleRegisterFieldChange("email", event.target.value)
              }
            />
          </label>

          <label className="field auth-field-shell">
            <span className="form-label">密码</span>
            <input
              type="password"
              value={mode === "login" ? loginForm.password : registerForm.password}
              placeholder="输入密码"
              onChange={(event) =>
                mode === "login"
                  ? handleLoginFieldChange("password", event.target.value)
                  : handleRegisterFieldChange("password", event.target.value)
              }
            />
          </label>

          {mode === "register" ? (
            <label className="field auth-field-shell">
              <span className="form-label">确认密码</span>
              <input
                type="password"
                value={registerForm.confirmPassword}
                placeholder="再次输入密码"
                onChange={(event) =>
                  handleRegisterFieldChange("confirmPassword", event.target.value)
                }
              />
            </label>
          ) : null}

          {mode === "register" ? (
            <div className="auth-compact-options">
              <div className="auth-goal-row">
                {goalOptions.map((goal) => (
                  <button
                    key={goal.value}
                    type="button"
                    className={`auth-goal-pill ${registerForm.goal === goal.value ? "active" : ""}`}
                    onClick={() => handleRegisterFieldChange("goal", goal.value)}
                  >
                    {goal.label}
                  </button>
                ))}
              </div>

              <label className="field auth-field-shell compact-select">
                <span className="form-label">训练频率</span>
                <select
                  value={registerForm.trainingDays}
                  onChange={(event) =>
                    handleRegisterFieldChange("trainingDays", event.target.value)
                  }
                >
                  {trainingDayOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          <label className="auth-check-row basic">
            <input
              type="checkbox"
              checked={
                mode === "login"
                  ? Boolean(loginForm.remember)
                  : Boolean(registerForm.remember)
              }
              onChange={(event) =>
                mode === "login"
                  ? handleLoginFieldChange("remember", event.target.checked)
                  : handleRegisterFieldChange("remember", event.target.checked)
              }
            />
            <span>在当前设备保持登录</span>
          </label>

          <p className={`auth-helper-line ${errorMessage ? "is-error" : ""}`} aria-live="polite">
            {helperText}
          </p>

          <div className="auth-form-actions basic">
            <button className="button auth-submit-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "处理中..." : mode === "login" ? "登录" : "创建账号"}
            </button>
            <button
              className="ghost-button auth-fill-button"
              type="button"
              onClick={fillStarterValues}
              disabled={isSubmitting}
            >
              {mode === "login" ? "填入演示账号" : "填入示例资料"}
            </button>
          </div>

          <p className="auth-footnote">{statusMessage}</p>
        </form>
      </section>
    </div>
  );
}
