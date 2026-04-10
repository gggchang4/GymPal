"use client";

import type { AppRoute } from "@/lib/routes";

export const routeTransitionStorageKey = "gympal-route-transition";

export interface RouteTransitionPayload {
  source: "auth";
  target: AppRoute;
  at: number;
  style: "activity-ring";
  orbitSize?: number;
}

function canUseSessionStorage() {
  return typeof window !== "undefined";
}

export function storeRouteTransition(transition: RouteTransitionPayload) {
  if (!canUseSessionStorage()) {
    return;
  }

  window.sessionStorage.setItem(routeTransitionStorageKey, JSON.stringify(transition));
}

export function consumeRouteTransition(): RouteTransitionPayload | null {
  if (!canUseSessionStorage()) {
    return null;
  }

  const storedValue = window.sessionStorage.getItem(routeTransitionStorageKey);

  if (!storedValue) {
    return null;
  }

  window.sessionStorage.removeItem(routeTransitionStorageKey);

  try {
    return JSON.parse(storedValue) as RouteTransitionPayload;
  } catch {
    return null;
  }
}
