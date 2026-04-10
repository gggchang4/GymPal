"use client";

import type { CSSProperties, PropsWithChildren } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandLoader } from "@/components/brand-loader";
import {
  authAdapter,
  readAuthSession,
  subscribeAuthChange,
  type AuthSession
} from "@/lib/auth";
import {
  appRoutes,
  type AppRoute,
  isAuthRoute
} from "@/lib/routes";
import { consumeRouteTransition, type RouteTransitionPayload } from "@/lib/route-transition";

const primaryNavItems: Array<{ href: AppRoute; label: string }> = [
  { href: "/chat", label: "对话" },
  { href: "/dashboard", label: "仪表盘" },
  { href: "/plans/current", label: "计划" },
  { href: "/profile", label: "档案" },
  { href: "/logs", label: "记录" },
  { href: "/exercises", label: "动作库" }
];

const authNavItems: Array<{ href: AppRoute; label: string }> = [
  { href: "/login", label: "登录" },
  { href: "/register", label: "注册" }
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "G"
  );
}

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const authArrivalTimerRef = useRef<number | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAuthArriving, setIsAuthArriving] = useState(false);
  const [authArrivalTransition, setAuthArrivalTransition] =
    useState<RouteTransitionPayload | null>(null);

  useEffect(() => {
    const syncSession = () => setSession(readAuthSession());
    syncSession();
    return subscribeAuthChange(syncSession);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const isAuthPage = isAuthRoute(pathname);

    if (isAuthPage) {
      setIsAuthArriving(false);
      setAuthArrivalTransition(null);
      return;
    }

    const transition = consumeRouteTransition();

    if (!transition) {
      setIsAuthArriving(false);
      setAuthArrivalTransition(null);
      return;
    }

    const isRecent = typeof transition.at === "number" && Date.now() - transition.at < 5000;
    const matchesTarget = pathname === transition.target || pathname.startsWith(`${transition.target}/`);

    if (
      transition.source !== "auth" ||
      transition.style !== "activity-ring" ||
      !isRecent ||
      !matchesTarget
    ) {
      setIsAuthArriving(false);
      setAuthArrivalTransition(null);
      return;
    }

    setIsAuthArriving(true);
    setAuthArrivalTransition(transition);

    if (authArrivalTimerRef.current) {
      window.clearTimeout(authArrivalTimerRef.current);
    }

    authArrivalTimerRef.current = window.setTimeout(() => {
      setIsAuthArriving(false);
      setAuthArrivalTransition(null);
      authArrivalTimerRef.current = null;
    }, 980);
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (authArrivalTimerRef.current) {
        window.clearTimeout(authArrivalTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  const isAuthPage = isAuthRoute(pathname);
  const navItems = isAuthPage ? authNavItems : primaryNavItems;
  const initials = useMemo(() => (session ? getInitials(session.user.name) : ""), [session]);

  const handleLogout = async () => {
    await authAdapter.logout();
    setSession(null);
    setMenuOpen(false);
    router.push(appRoutes.login);
  };

  return (
    <div className="app-shell">
      <BrandLoader />
      {isAuthArriving ? <AuthArrivalLayer transition={authArrivalTransition} /> : null}
      <header className="shell-header">
        <div className={`shell-unified-bar ${isAuthArriving ? "is-auth-arriving" : ""}`}>
          <Link href={appRoutes.chat} className="brand-wordmark">
            <Image
              src="/brand/gympal-logo.jpg"
              alt="GymPal"
              width={40}
              height={40}
              className="brand-image"
            />
            <span>GymPal</span>
          </Link>

          <nav className="nav-bar-list" aria-label="主导航">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-pill ${isActive(pathname, item.href) ? "active" : ""}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="shell-account" ref={menuRef}>
            {session ? (
              <>
                <button
                  type="button"
                  className={`shell-account-trigger ${menuOpen ? "open" : ""}`}
                  onClick={() => setMenuOpen((current) => !current)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="打开账户菜单"
                >
                  <span className="shell-avatar is-filled" aria-hidden="true">
                    {session.user.avatarUrl ? (
                      <Image
                        src={session.user.avatarUrl}
                        alt=""
                        width={40}
                        height={40}
                        className="shell-avatar-image"
                      />
                    ) : (
                      <span className="shell-avatar-fallback">{initials}</span>
                    )}
                  </span>
                </button>

                {menuOpen ? (
                  <div className="shell-account-menu" role="menu">
                    <div className="shell-account-menu-head">
                      <strong>{session.user.name}</strong>
                      <span>{session.user.email}</span>
                    </div>
                    <Link
                      href={appRoutes.profile}
                      className="shell-account-menu-item"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                    >
                      个人档案
                    </Link>
                    <button
                      type="button"
                      className="shell-account-menu-item"
                      role="menuitem"
                      onClick={handleLogout}
                    >
                      退出登录
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <Link href="/login" className="shell-account-trigger is-empty" aria-label="前往登录">
                <span className="shell-avatar" aria-hidden="true">
                  <span className="shell-avatar-empty" />
                </span>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="shell-main">
        <div className={`shell-content ${isAuthArriving ? "is-auth-arriving" : ""}`}>{children}</div>
      </main>
    </div>
  );
}

function AuthArrivalLayer({ transition }: { transition: RouteTransitionPayload | null }) {
  const orbitStyle =
    transition?.orbitSize !== undefined
      ? ({
          "--auth-arrival-orbit-size": `${transition.orbitSize}px`
        } as CSSProperties)
      : undefined;

  return (
    <div className="auth-arrival-layer" aria-hidden="true">
      <div className="auth-arrival-glow" />
      <div className="auth-arrival-orbit" style={orbitStyle}>
        <svg viewBox="0 0 220 220" className="auth-arrival-orbit-svg" role="presentation">
          <circle className="auth-arrival-orbit-track" cx="110" cy="110" r="88" />
          <circle
            className="auth-arrival-orbit-progress"
            cx="110"
            cy="110"
            r="88"
            strokeDasharray="552.92"
          />
        </svg>
      </div>
    </div>
  );
}
