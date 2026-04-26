import { clearAgentThreadId } from "@/lib/agent-thread";

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
  source: "api";
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

interface AuthApiResponse {
  ok?: boolean;
  message?: string;
  userId?: string;
  email?: string;
  token?: string;
  name?: string;
  goal?: string;
  trainingDays?: string;
  avatarUrl?: string;
}

interface AuthAdapter {
  implementation: "api";
  login(payload: LoginPayload): Promise<AuthResult>;
  register(payload: RegisterPayload): Promise<AuthResult>;
  logout(): Promise<void>;
  getSession(): AuthSession | null;
}

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:3001";
const authSessionStorageKey = "gympal-auth-session";
const authChangeEvent = "gympal-auth-changed";
const authTokenCookieKey = "gympal-access-token";

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

function emitAuthChange() {
  if (!canUseDom()) {
    return;
  }

  window.dispatchEvent(new Event(authChangeEvent));
}

function buildUserName(email: string, preferredName?: string) {
  if (preferredName && preferredName.trim().length > 0) {
    return preferredName.trim();
  }

  const localPart = email.split("@")[0] ?? "GymPal Member";
  const derived = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return derived || "GymPal Member";
}

function createSession(user: AuthUser, token: string): AuthSession {
  return {
    token,
    user,
    source: "api"
  };
}

function readCookieValue(name: string) {
  if (!canUseDom()) {
    return null;
  }

  const cookie = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));

  if (!cookie) {
    return null;
  }

  const rawValue = cookie.slice(name.length + 1);
  return rawValue ? decodeURIComponent(rawValue) : null;
}

function writeAccessTokenCookie(token: string) {
  if (!canUseDom()) {
    return;
  }

  document.cookie = `${authTokenCookieKey}=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=2592000`;
}

function clearAccessTokenCookie() {
  if (!canUseDom()) {
    return;
  }

  document.cookie = `${authTokenCookieKey}=; Path=/; SameSite=Lax; Max-Age=0`;
}

function storeSession(session: AuthSession) {
  if (!canUseDom()) {
    return;
  }

  window.localStorage.setItem(authSessionStorageKey, JSON.stringify(session));
  writeAccessTokenCookie(session.token);
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

export function readAuthAccessToken() {
  const cookieToken = readCookieValue(authTokenCookieKey);
  if (cookieToken) {
    return cookieToken;
  }

  return readAuthSession()?.token ?? null;
}

export function clearAuthSession() {
  if (!canUseDom()) {
    return;
  }

  window.localStorage.removeItem(authSessionStorageKey);
  clearAgentThreadId();
  clearAccessTokenCookie();
  emitAuthChange();
}

export function readAuthUserId() {
  return readAuthSession()?.user.id ?? null;
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

  let result: AuthApiResponse = {};

  try {
    result = (await response.json()) as AuthApiResponse;
  } catch {
    result = {};
  }

  if (!response.ok || result?.ok === false) {
    return {
      ok: false,
      message:
        result?.message ??
        (response.ok
          ? "Authentication failed."
          : `Authentication request failed with status ${response.status}.`)
    };
  }

  if (!result.token) {
    return {
      ok: false,
      message: "Authentication succeeded, but the access token was missing."
    };
  }

  const profilePayload = payload as Partial<RegisterPayload>;
  const user: AuthUser = {
    id: result.userId ?? "unknown-user",
    name: buildUserName(result.email ?? payload.email, result.name ?? profilePayload.name),
    email: result.email ?? payload.email,
    goal: result.goal ?? profilePayload.goal ?? "fat_loss",
    trainingDays: result.trainingDays ?? profilePayload.trainingDays ?? "3",
    createdAt: new Date().toISOString(),
    avatarUrl: result.avatarUrl ?? profilePayload.avatarUrl ?? ""
  };

  const session = createSession(user, result.token);
  storeSession(session);

  return {
    ok: true,
    message: result.message ?? "Authentication succeeded.",
    session
  };
}

export const authAdapter: AuthAdapter = {
  implementation: "api",
  async login(payload) {
    try {
      return await requestAuth(AUTH_ENDPOINTS.login, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed.";
      return {
        ok: false,
        message
      };
    }
  },
  async register(payload) {
    try {
      return await requestAuth(AUTH_ENDPOINTS.register, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed.";
      return {
        ok: false,
        message
      };
    }
  },
  async logout() {
    try {
      await fetch(`${backendBaseUrl}${AUTH_ENDPOINTS.logout}`, {
        method: "POST",
        cache: "no-store"
      });
    } catch {
      // The local session should still be cleared even if the backend is unavailable.
    }

    clearAuthSession();
  },
  getSession() {
    return readAuthSession();
  }
};
