"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CommandPalette, IconButton, LogoMark, Wordmark, icons, useTheme, type CommandAction } from "@knitted/ui";
import { ModelAtWork } from "./ModelAtWork";
import { ModelPresence } from "./ModelPresence";

const { Home, LayoutGrid, Settings, Moon, Sun, Plus, Command, Sparkles } = icons;

const NAV = [
  { href: "/", label: "Home", Icon: Home, match: (p: string) => p === "/" },
  { href: "/projects", label: "Projects", Icon: LayoutGrid, match: (p: string) => p.startsWith("/projects") },
  { href: "/ask", label: "Ask", Icon: Sparkles, match: (p: string) => p.startsWith("/ask") },
  { href: "/settings", label: "Settings", Icon: Settings, match: (p: string) => p.startsWith("/settings") },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Read after mount on purpose: the server cannot know this preference, and
    // reading it during render would mismatch the server's HTML.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setCollapsed(localStorage.getItem("knitted.nav") === "collapsed"); } catch {}
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem("knitted.nav", c ? "open" : "collapsed"); } catch {}
      return !c;
    });
  };

  const actions: CommandAction[] = useMemo(
    () => [
      { id: "go-home", label: "Go to Home", group: "Pages", icon: <Home size={15} />, run: () => router.push("/") },
      { id: "go-projects", label: "Go to Projects", group: "Pages", icon: <LayoutGrid size={15} />, run: () => router.push("/projects") },
      { id: "go-ask", label: "Ask your model", group: "Pages", icon: <Sparkles size={15} />, keywords: "chat model claude", run: () => router.push("/ask") },
      { id: "go-settings", label: "Go to Settings", group: "Pages", icon: <Settings size={15} />, run: () => router.push("/settings") },
      { id: "new-project", label: "New project", group: "Actions", icon: <Plus size={15} />, keywords: "create", run: () => router.push("/projects?new=1") },
      { id: "theme", label: theme === "day" ? "Switch to Night" : "Switch to Day", group: "Actions", icon: theme === "day" ? <Moon size={15} /> : <Sun size={15} />, keywords: "theme dark light", run: () => setTheme(theme === "day" ? "night" : "day") },
    ],
    [router, theme, setTheme],
  );

  return (
    <div style={{ display: "flex", height: "100dvh", overflow: "hidden" }}>
      <nav
        aria-label="Main"
        style={{
          width: collapsed ? 64 : 224,
          transition: "width var(--t-panel) var(--ease)",
          background: "var(--rail)",
          color: "var(--on-rail)",
          display: "flex",
          flexDirection: "column",
          padding: "var(--space-3)",
          gap: "var(--space-1)",
          flexShrink: 0,
        }}
      >
        <Link href="/" aria-label="knitted.studio home" style={{ display: "flex", alignItems: "center", gap: 10, padding: "var(--space-2)", marginBottom: "var(--space-4)" }}>
          <LogoMark size={28} />
          {!collapsed && <Wordmark size={19} color="var(--on-rail)" muted="var(--on-rail-muted)" />}
        </Link>
        {NAV.map(({ href, label, Icon, match }) => {
          const on = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              title={collapsed ? label : undefined}
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: "var(--radius-md)",
                fontWeight: 600, fontSize: 13,
                background: on ? "var(--rail-active)" : "transparent",
                color: on ? "var(--rail-active-ink)" : "var(--on-rail-muted)",
              }}
            >
              <Icon size={18} aria-hidden />
              {!collapsed && label}
            </Link>
          );
        })}
        <div style={{ flex: 1 }} />
        <ModelPresence variant={collapsed ? "rail-collapsed" : "rail"} />
        <button
          onClick={() => setTheme(theme === "day" ? "night" : "day")}
          className="icon-btn"
          style={{ width: "auto", justifyContent: "flex-start", gap: 12, padding: "0 12px", color: "var(--on-rail-muted)", height: 36, display: "flex", alignItems: "center" }}
          aria-label={theme === "day" ? "Switch to Night" : "Switch to Day"}
        >
          {theme === "day" ? <Moon size={18} /> : <Sun size={18} />}
          {!collapsed && <span style={{ fontSize: 13, fontWeight: 600 }}>{theme === "day" ? "Switch to Night" : "Switch to Day"}</span>}
        </button>
        <button
          onClick={toggle}
          className="icon-btn"
          style={{ width: "auto", justifyContent: "flex-start", gap: 12, padding: "0 12px", color: "var(--on-rail-muted)", height: 36, display: "flex", alignItems: "center" }}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          <Command size={18} aria-hidden />
          {!collapsed && <span style={{ fontSize: 13, fontWeight: 600 }}>Collapse sidebar</span>}
        </button>
      </nav>
      <main id="main" style={{ flex: 1, overflow: "auto", minWidth: 0, position: "relative" }}>
        {children}
      </main>
      <ModelAtWork />
      <CommandPalette actions={actions} />
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-8)" }}>
      <div>
        {eyebrow && <p className="eyebrow" style={{ marginBottom: "var(--space-2)" }}>{eyebrow}</p>}
        <h1 className="h1" style={{ margin: 0 }}>{title}</h1>
      </div>
      {children && <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>{children}</div>}
    </header>
  );
}

export { IconButton };
