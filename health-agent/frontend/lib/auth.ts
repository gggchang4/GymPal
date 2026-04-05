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

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
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
    return {
      ok: false,
      message: `Request failed with status ${response.status}.`
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
      message: result.message ?? "Authentication failed."
    };
  }

  const payloadWithProfile = payload as RegisterPayload;
  const session = createSession(
    {
      id: result.userId ?? "api-user",
      name:
        result.name ??
        ("name" in payloadWithProfile ? payloadWithProfile.name : "GymPal Member"),
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
    message: "GymPal access granted.",
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
        message: "Email or password did not match the current mock user list."
      };
    }

    const { password: _password, ...safeUser } = matchedUser;
    const session = createSession(safeUser, "mock");
    storeSession(session);

    return {
      ok: true,
      message: `Welcome back, ${safeUser.name}. Redirecting to your training workspace...`,
      session
    };
  },
  async register(payload) {
    const users = readStoredUsers();
    const normalizedEmail = payload.email.trim().toLowerCase();

    if (users.some((user) => user.email.trim().toLowerCase() === normalizedEmail)) {
      return {
        ok: false,
        message: "That email already exists in the mock auth store."
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
      message: "Account created in mock mode. Your backend contract is still ready to swap in.",
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
        message: "GymPal could not reach the auth API."
      };
    }
  },
  async register(payload) {
    try {
      return await requestAuth(AUTH_ENDPOINTS.register, payload);
    } catch {
      return {
        ok: false,
        message: "GymPal could not reach the auth API."
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
