"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PropsWithChildren, useEffect, useMemo, useRef, useState } from "react";
import { BrandLoader } from "@/components/brand-loader";
import {
  authAdapter,
  readAuthSession,
  subscribeAuthChange,
  type AuthSession
} from "@/lib/auth";

const primaryNavItems = [
  { href: "/chat", label: "对话" },
  { href: "/dashboard", label: "仪表盘" },
  { href: "/plans/current", label: "计划" },
  { href: "/profile", label: "档案" },
  { href: "/logs", label: "记录" },
  { href: "/exercises", label: "动作" }
];

const authNavItems = [
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
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const syncSession = () => setSession(readAuthSession());
    syncSession();
    return subscribeAuthChange(syncSession);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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

  const isAuthPage = pathname === "/login" || pathname === "/register";
  const navItems = isAuthPage ? authNavItems : primaryNavItems;
  const initials = useMemo(
    () => (session ? getInitials(session.user.name) : ""),
    [session]
  );

  const handleLogout = async () => {
    await authAdapter.logout();
    setSession(null);
    setMenuOpen(false);
  };

  return (
    <div className="app-shell">
      <BrandLoader />
      <header className="shell-header">
        <div className="shell-unified-bar">
          <Link href="/chat" className="brand-wordmark">
            <Image
              src="/brand/gympal-logo.jpg"
              alt="GymPal"
              width={40}
              height={40}
              className="brand-image"
            />
            <span>GymPal</span>
          </Link>

          <nav className="nav-bar-list" aria-label="Primary navigation">
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
                      href="/profile"
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
              <Link href="/login" className="shell-account-trigger is-empty" aria-label="登录">
                <span className="shell-avatar" aria-hidden="true">
                  <span className="shell-avatar-empty" />
                </span>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="shell-main">
        <div className="shell-content">{children}</div>
      </main>
    </div>
  );
}
