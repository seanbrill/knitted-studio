"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { AgentCall, AgentState } from "@knitted/core";
import { Button, Popover, icons } from "@knitted/ui";
import { RECENT_MS, ago, current, endedAt, isActive, pathFor, setPaused, useAgent, useNow } from "@/lib/agent";
import { useFollow } from "@/lib/follow";

const { Check, X, AlertTriangle } = icons;

/** The newest call that is somewhere to go: an edit, or a model looking at a pattern. */
const lead = (s: AgentState) => [...s.calls].reverse().find((x) => (x.edits || x.tool === "preview_pattern") && pathFor(x));

/**
 * A model at work, where the person can see it: who it is, what it is doing and where,
 * with Follow (go where it works, and keep going as it moves) and Pause (its changes are
 * refused until Resume). In the nav rail on every page, and in the editor's top bar.
 */
export function ModelPresence({ variant, patternId }: { variant: "rail" | "rail-collapsed" | "bar"; patternId?: string }) {
  const s = useAgent();
  const now = useNow((t) => isActive(s, t));
  const router = useRouter();
  const pathname = usePathname();
  const following = useFollow((f) => f.on);

  // Following: go where the newest edit is, as each one comes in. One effect, so a page
  // the person went to themselves is seen before anything could take them away from it.
  useEffect(() => {
    const f = useFollow.getState();
    if (!f.on || !s) return;
    if (pathname === f.from) return; // on the way: the page it is leaving still shows
    if (pathname !== f.target) { f.stop(); return; } // somewhere else, by their own hand
    if (f.from) f.arrived();
    const c = lead(s);
    const to = c && pathFor(c);
    if (to && to !== pathname) { f.went(to, pathname); router.push(to); }
  }, [s, following, pathname, router]);

  if (!s || (!isActive(s, now) && !s.paused)) return null;
  const c = current(s);
  const who = c?.client ?? "Your model";
  const running = c?.state === "running" && !s.paused;
  const here = !!patternId && c?.where.patternId === patternId && (running || (!!c && now - endedAt(c) < RECENT_MS));
  const what = s.paused ? "Paused, its changes wait for you" : !c ? "" : running ? c.summary : `${c.summary}${c.state === "refused" ? ", refused" : c.state === "failed" ? ", failed" : ""}`;
  const shown = variant === "bar" && here && running ? `editing this pattern: ${what}` : what;
  // Its name is what it shows, then what it does not: when, and what pressing it does.
  const rest = `${running || s.paused || !c ? "" : `, ${ago(endedAt(c), now)}`}. Show what it is doing.`;
  const label = `${who}: ${shown}${rest}`;

  const dot = (
    <span aria-hidden className={running ? "working" : undefined}
      style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, ...(running ? {} : s.paused ? { border: "1.5px solid var(--ember)" } : { background: "var(--red)" }) }} />
  );
  // The space between name and summary draws nothing, but keeps the words shown words of
  // the button's name, as a person using voice control says them (WCAG 2.5.3).
  const name = <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{who}</span>;
  const trigger = variant === "rail-collapsed" ? (
    <button className="icon-btn" aria-label={label} title={label} style={{ width: 40, height: 36, display: "grid", placeItems: "center" }}>{dot}</button>
  ) : variant === "rail" ? (
    <button aria-label={label} style={{ display: "grid", gridTemplateColumns: "8px 1fr", gap: "2px 10px", alignItems: "center", textAlign: "left", padding: "8px 12px", borderRadius: "var(--radius-md)", border: "1px solid rgba(246, 243, 239, 0.14)", background: "transparent", color: "var(--on-rail)", font: "inherit", fontSize: 13, cursor: "pointer", marginBottom: "var(--space-2)" }}>
      {dot}{name}{" "}
      <span style={{ gridColumn: 2, fontSize: 12, color: "var(--on-rail-muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{shown}</span>
    </button>
  ) : (
    <button className="chip chip-button" aria-label={label} style={{ maxWidth: 380, borderColor: here ? "var(--red)" : undefined }}>
      {dot}{name}{" "}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink-muted)" }}>{shown}</span>
    </button>
  );
  return <Popover trigger={trigger} align="start"><Panel s={s} now={now} who={who} /></Popover>;
}

function StateMark({ c }: { c: AgentCall }) {
  if (c.state === "running") return <span aria-label="Working" className="working" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", margin: 4 }} />;
  if (c.state === "done") return <Check size={14} aria-label="Done" style={{ color: "var(--success)" }} />;
  if (c.state === "refused") return <X size={14} aria-label="Refused" style={{ color: "var(--ember-ink)" }} />;
  return <AlertTriangle size={14} aria-label="Failed" style={{ color: "var(--danger)" }} />;
}

/** What it did lately, newest first, with the two things a person can do about it. */
function Panel({ s, now, who }: { s: AgentState; now: number; who: string }) {
  const follow = useFollow();
  const router = useRouter();
  const pathname = usePathname();
  const c = lead(s);
  const to = c ? pathFor(c) : null;
  const calls = [...s.calls].reverse().slice(0, 12);
  return (
    <div role="region" aria-label="What your model is doing" style={{ width: 340, display: "grid", gap: "var(--space-3)" }}>
      <p className="body-sm" style={{ margin: 0 }}>
        <strong>{who}</strong>{s.paused ? " is paused. It can still look, but its changes are refused until you resume it." : " is working in this studio. Its changes appear as it makes them, and Undo leaves them alone."}
      </p>
      <ol aria-label="What it did" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6, maxHeight: 260, overflow: "auto" }}>
        {calls.map((x) => (
          <li key={x.id} className="body-sm" style={{ display: "grid", gridTemplateColumns: "16px 1fr auto", gap: 8, alignItems: "start" }}>
            <StateMark c={x} />
            <span>{x.summary}{x.note && <span style={{ display: "block", color: "var(--ink-muted)" }}>{x.note}</span>}</span>
            <span style={{ color: "var(--ink-muted)", whiteSpace: "nowrap" }}>{x.state === "running" ? "now" : ago(endedAt(x), now)}</span>
          </li>
        ))}
      </ol>
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button size="sm" onClick={() => void setPaused(!s.paused)}>{s.paused ? "Resume" : "Pause"}</Button>
        {follow.on
          ? <Button size="sm" variant="ghost" onClick={follow.stop}>Stop following</Button>
          : <Button size="sm" variant="ghost" disabled={!to} onClick={() => { follow.start(to!, pathname); if (to !== pathname) router.push(to!); }}>Follow</Button>}
      </div>
    </div>
  );
}
