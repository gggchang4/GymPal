import type { Route } from "next";

interface NavItem {
  href: AppRoute;
  label: string;
}

export const appRoutes = {
  home: "/" as Route,
  chat: "/chat" as Route,
  dashboard: "/dashboard" as Route,
  exercises: "/exercises" as Route,
  login: "/login" as Route,
  logs: "/logs" as Route,
  planCurrent: "/plans/current" as Route,
  profile: "/profile" as Route,
  register: "/register" as Route
} as const;

export type AppRoute = (typeof appRoutes)[keyof typeof appRoutes];

export const primaryNavItems: readonly NavItem[] = [
  { href: appRoutes.chat, label: "对话" },
  { href: appRoutes.dashboard, label: "仪表盘" },
  { href: appRoutes.planCurrent, label: "计划" },
  { href: appRoutes.profile, label: "档案" },
  { href: appRoutes.logs, label: "记录" },
  { href: appRoutes.exercises, label: "动作库" }
];

export const authNavItems: readonly NavItem[] = [
  { href: appRoutes.login, label: "登录" },
  { href: appRoutes.register, label: "注册" }
];

const authRouteSet = new Set<AppRoute>([appRoutes.login, appRoutes.register]);

export function isAuthRoute(pathname: string) {
  return authRouteSet.has(pathname as AppRoute);
}
