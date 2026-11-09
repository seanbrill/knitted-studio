"use client";

// A thin line across the top while a page you go to loads: from the click on a link until the
// new page is there and has its first data. It shows only after 150 ms, so a fast page shows
// nothing, and it is only to see: a screen reader hears the new page itself.

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** The studio's GET requests in flight, not counting the change stream, which stays open. */
let inflight = 0;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((f) => f());

function countRequests() {
  const w = window as Window & { __knittedCounted?: boolean };
  if (w.__knittedCounted) return;
  w.__knittedCounted = true;
  const real = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET" || !url.includes("/api/") || url.includes("/api/events")) return real(input, init);
    inflight++;
    tell();
    return real(input, init).finally(() => { inflight--; tell(); });
  };
}

type Phase = "idle" | "going" | "arriving" | "done";

export function LoadBar() {
  const path = usePathname();
  const [phase, setPhase] = useState<Phase>("idle");
  const started = useRef(0);
  const seen = useRef(path);

  useEffect(() => {
    countRequests();
    // Capture: before the link's own handler, which takes the click over.
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin || to.pathname === location.pathname) return;
      started.current = Date.now();
      setPhase("going");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // The address changed: the new page is mounting and asking for its data.
  useEffect(() => {
    if (seen.current === path) return;
    seen.current = path;
    const t = setTimeout(() => setPhase((p) => { if (p === "idle") started.current = Date.now(); return "arriving"; }), 0);
    return () => clearTimeout(t);
  }, [path]);

  useEffect(() => {
    if (phase === "idle") return;
    if (phase === "done") { const t = setTimeout(() => setPhase("idle"), 280); return () => clearTimeout(t); }
    // Never more than 10 s: a page that keeps asking is there by then.
    const end = () => setPhase(Date.now() - started.current < 150 ? "idle" : "done");
    const cap = setTimeout(end, 10_000);
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(quiet);
      // Quiet for a moment, so the requests the new page makes as it mounts are counted.
      if (phase === "arriving" && inflight === 0) quiet = setTimeout(end, 120);
    };
    listeners.add(check);
    check();
    return () => { clearTimeout(cap); clearTimeout(quiet); listeners.delete(check); };
  }, [phase]);

  if (phase === "idle") return null;
  return <div className="load-bar" data-phase={phase === "done" ? "done" : "on"} aria-hidden />;
}
