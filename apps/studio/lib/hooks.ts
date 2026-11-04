"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeChanges } from "@knitted/core/client";

/**
 * Load something and keep it fresh. Refetches when the library changes in any
 * process (the SSE stream), so an edit made through MCP shows up here without
 * a reload. `deps` re-runs the load when its inputs change.
 */
export function useLive<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  // Kept current from an effect, not during render: the latest `load` closure
  // is what a later SSE-triggered refresh must call.
  useEffect(() => { loadRef.current = load; });
  // Only the newest load may land. Pick a kind and then search, and both loads are in
  // flight; if the first answers last, it must not put back what the search took away.
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const n = ++latest.current;
    try {
      const d = await loadRef.current();
      if (n === latest.current) { setData(d); setError(null); }
    } catch (e) {
      if (n === latest.current) setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeChanges(() => { clearTimeout(t); t = setTimeout(() => void refresh(), 150); });
    return () => { off(); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, ...deps]);

  return { data, error, refresh, setData };
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${u[i]}`;
}
