"use client";

// What a model is doing, on every page outside the editor (which shows it on the canvas):
// who, the step it is on, and the last thing it wrote, with a way to go and see it there and
// to Follow it. Small, in a corner, and it can be made smaller still.

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button, IconButton, icons } from "@knitted/ui";
import { current, isActive, pathFor, useAgent, useNow } from "@/lib/agent";
import { useFollow } from "@/lib/follow";
import { lead } from "./ModelPresence";

const { Minimize2, Eye } = icons;

export function ModelAtWork() {
  const s = useAgent();
  const now = useNow((t) => isActive(s, t));
  const pathname = usePathname();
  const router = useRouter();
  const follow = useFollow();
  const [small, setSmall] = useState(false);
  if (!s || !isActive(s, now) || pathname.startsWith("/ask")) return null; // the chat shows it there
  const c = current(s);
  if (!c) return null;
  const who = c.client ?? "Your model";
  const running = c.state === "running" && !s.paused;
  const what = s.paused ? "Paused, its changes wait for you" : `${c.summary}${c.state === "failed" ? ", failed" : c.state === "refused" ? ", refused" : ""}`;
  const note = (s.live ?? []).filter((l) => !l.ended && l.text.trim()).at(-1)?.text.trim().split("\n").filter(Boolean).at(-1);
  const at = lead(s);
  const to = (at && pathFor(at)) ?? pathFor(c);
  const dot = <span aria-hidden className={running ? "working" : undefined} style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, ...(running ? {} : { background: "var(--red)" }) }} />;

  if (small) return (
    <button className="chip chip-button floating" onClick={() => setSmall(false)} aria-label={`${who}: ${what}. Show more.`}
      style={{ position: "fixed", right: 16, bottom: 16, zIndex: 39, maxWidth: 360, gap: 8 }}>
      {dot}<span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{who}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink-muted)" }}>{what}</span>
    </button>
  );
  return (
    <section className="panel floating" aria-label={`What ${who} is doing`} style={{ position: "fixed", right: 16, bottom: 16, zIndex: 39, width: 340, padding: "var(--space-3)", display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {dot}<strong className="label" style={{ flex: 1 }}>{who}{running ? " is working" : ""}</strong>
        <IconButton label="Make smaller" onClick={() => setSmall(true)}><Minimize2 size={14} aria-hidden /></IconButton>
      </div>
      <p className="body-sm" role="status" aria-live="polite" style={{ margin: 0 }}>{what}</p>
      {note && <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{note}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
        {to && to !== pathname && <Button size="sm" onClick={() => router.push(to)}><Eye size={13} aria-hidden /> Show me</Button>}
        {follow.on
          ? <Button size="sm" variant="ghost" onClick={follow.stop}>Stop following</Button>
          : <Button size="sm" variant="ghost" disabled={!to} onClick={() => { follow.start(to!, pathname); if (to !== pathname) router.push(to!); }}>Follow</Button>}
      </div>
    </section>
  );
}
