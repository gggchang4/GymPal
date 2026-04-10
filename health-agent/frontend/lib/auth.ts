import { frontendEnv } from "@/lib/env";

export type AuthMode = "login" | "register";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  goal: string;
  trainingDays: string;
  createdAt: string;
  avatarUrl?: string;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  source: "mock" | "api";
}

export interface LoginPayload {
  email: string;
  password: string;
  remember?: boolean;
}

export interface RegisterPayload extends LoginPayload {
  name: string;
  goal: string;
  trainingDays: string;
  avatarUrl?: string;
}

export interface AuthResult {
  ok: boolean;
  message: string;
  session?: AuthSession;
}

interface StoredAuthUser extends AuthUser {
  password: string;
}

interface AuthAdapter {
  implementation: "mock" | "api";
  login(payload: LoginPayload): Promise<AuthResult>;
  register(payload: RegisterPayload): Promise<AuthResult>;
  logout(): Promise<void>;
  getSession(): AuthSession | null;
}

const { backendBaseUrl } = frontendEnv;
const authImplementation =
  process.env.NEXT_PUBLIC_AUTH_IMPLEMENTATION === "api" ? "api" : "mock";

const authUsersStorageKey = "gympal-auth-users";
const authSessionStorageKey = "gympal-auth-session";
const authChangeEvent = "gympal-auth-changed";

export const AUTH_ENDPOINTS = {
  login: "/auth/login",
  register: "/auth/register",
  logout: "/auth/logout"
} as const;

function canUseDom() {
  return typeof window !== "undefined";
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function buildDemoUser(): StoredAuthUser {
  return {
    id: "mock-user-demo",
    name: "GymPal Demo",
    email: "demo@gympal.ai",
    password: "gympal123",
    goal: "fat_loss",
    trainingDays: "4",
    createdAt: "2026-04-05T00:00:00.000Z",
    avatarUrl: ""
  };
}

function emitAuthChange() {
  if (!canUseDom()) {
    return;
  }

  window.dispatchEvent(new Event(authChangeEvent));
}

function readStoredUsers(): StoredAuthUser[] {
  if (!canUseDom()) {
    return [buildDemoUser()];
  }

  const storedUsers = parseJson<StoredAuthUser[]>(
    window.localStorage.getItem(authUsersStorageKey),
    []
  );

  if (storedUsers.length > 0) {
    return storedUsers;
  }

  const seededUsers = [buildDemoUser()];
  window.localStorage.setItem(authUsersStorageKey, JSON.stringify(seededUsers));
  return seededUsers;
}

function writeStoredUsers(users: StoredAuthUser[]) {
  if (!canUseDom()) {
    return;
  }

  window.localStorage.setItem(authUsersStorageKey, JSON.stringify(users));
}

function createSession(user: AuthUser, source: "mock" | "api"): AuthSession {
  return {
    token: `gympal-${source}-${user.id}`,
    user,
    source
  };
}

function storeSession(session: AuthSession) {
  if (!canUseDom()) {
    return;
  }

  window.localStorage.setItem(authSessionStorageKey, JSON.stringify(session));
  emitAuthChange();
}

export function readAuthSession(): AuthSession | null {
  if (!canUseDom()) {
    return null;
  }

  return parseJson<AuthSession | null>(
    window.localStorage.getItem(authSessionStorageKey),
    null
  );
}

export function clearAuthSession() {
  if (!canUseDom()) {
    return;
  }

  window.localStorage.removeItem(authSessionStorageKey);
  emitAuthChange();
}

export function subscribeAuthChange(listener: () => void) {
  if (!canUseDom()) {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (!event.key || event.key === authSessionStorageKey) {
      listener();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(authChangeEvent, listener);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(authChangeEvent, listener);
  };
}

async function requestAuth(
  path: string,
  payload: LoginPayload | RegisterPayload
): Promise<AuthResult> {
  const response = await fetch(`${backendBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  if (!response.ok) {
    let errorMessage = `认证请求失败（状态码 ${response.status}）。`;

    try {
      const result = (await response.json()) as { message?: string };
      if (result.message) {
        errorMessage = result.message;
      }
    } catch {
      // Ignore malformed error bodies and keep the status-based fallback.
    }

    return {
      ok: false,
      message: errorMessage
    };
  }

  const result = (await response.json()) as {
    ok?: boolean;
    message?: string;
    userId?: string;
    email?: string;
    token?: string;
    name?: string;
    goal?: string;
    trainingDays?: string;
    avatarUrl?: string;
  };

  if (result.ok === false) {
    return {
      ok: false,
      message: result.message ?? "认证失败，请检查输入后重试。"
    };
  }

  const payloadWithProfile = payload as RegisterPayload;
  const session = createSession(
    {
      id: result.userId ?? "api-user",
      name:
        result.name ??
        ("name" in payloadWithProfile ? payloadWithProfile.name : "GymPal 会员"),
      email: result.email ?? payload.email,
      goal: result.goal ?? ("goal" in payloadWithProfile ? payloadWithProfile.goal : "fat_loss"),
      trainingDays:
        result.trainingDays ??
        ("trainingDays" in payloadWithProfile ? payloadWithProfile.trainingDays : "3"),
      createdAt: new Date().toISOString(),
      avatarUrl:
        result.avatarUrl ??
        ("avatarUrl" in payloadWithProfile ? payloadWithProfile.avatarUrl ?? "" : "")
    },
    "api"
  );

  session.token = result.token ?? session.token;
  storeSession(session);

  return {
    ok: true,
    message: "登录成功，正在进入你的训练空间。",
    session
  };
}

const mockAuthAdapter: AuthAdapter = {
  implementation: "mock",
  async login(payload) {
    const users = readStoredUsers();
    const matchedUser = users.find(
      (user) =>
        user.email.trim().toLowerCase() === payload.email.trim().toLowerCase() &&
        user.password === payload.password
    );

    if (!matchedUser) {
      return {
        ok: false,
        message: "邮箱或密码不正确，请重新输入。"
      };
    }

    const { password: _password, ...safeUser } = matchedUser;
    const session = createSession(safeUser, "mock");
    storeSession(session);

    return {
      ok: true,
      message: `欢迎回来，${safeUser.name}，正在进入你的训练空间。`,
      session
    };
  },
  async register(payload) {
    const users = readStoredUsers();
    const normalizedEmail = payload.email.trim().toLowerCase();

    if (users.some((user) => user.email.trim().toLowerCase() === normalizedEmail)) {
      return {
        ok: false,
        message: "这个邮箱已经注册过了，请直接登录。"
      };
    }

    const nextUser: StoredAuthUser = {
      id: `mock-user-${Date.now()}`,
      name: payload.name.trim(),
      email: normalizedEmail,
      password: payload.password,
      goal: payload.goal,
      trainingDays: payload.trainingDays,
      createdAt: new Date().toISOString(),
      avatarUrl: payload.avatarUrl ?? ""
    };

    writeStoredUsers([...users, nextUser]);

    const { password: _password, ...safeUser } = nextUser;
    const session = createSession(safeUser, "mock");
    storeSession(session);

    return {
      ok: true,
      message: "账号已创建，当前为演示模式，后端接口仍可随时切换接入。",
      session
    };
  },
  async logout() {
    clearAuthSession();
  },
  getSession() {
    return readAuthSession();
  }
};

const apiAuthAdapter: AuthAdapter = {
  implementation: "api",
  async login(payload) {
    try {
      return await requestAuth(AUTH_ENDPOINTS.login, payload);
    } catch {
      return {
        ok: false,
        message: "暂时无法连接认证服务，请稍后重试。"
      };
    }
  },
  async register(payload) {
    try {
      return await requestAuth(AUTH_ENDPOINTS.register, payload);
    } catch {
      return {
        ok: false,
        message: "暂时无法连接认证服务，请稍后重试。"
      };
    }
  },
  async logout() {
    clearAuthSession();
  },
  getSession() {
    return readAuthSession();
  }
};

export const authAdapter: AuthAdapter =
  authImplementation === "api" ? apiAuthAdapter : mockAuthAdapter;
