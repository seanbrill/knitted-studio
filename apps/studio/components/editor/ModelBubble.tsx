"use client";

import { useCallback, useState } from "react";
import type { AgentCall, AgentLive } from "@knitted/core";
import { IconButton, Markdown, Tooltip, icons } from "@knitted/ui";
import { meets, type Rect } from "@/lib/editor/live";

const { Minimize2, Sparkles, X } = icons;
const EDGE = 12;
const WIDE = 320;
const DOT = 32;
// The corners first, then a quarter of the way along the top and bottom: between the handles
// of a selection as big as the canvas.
const SPOTS = ["bottom-left", "bottom-right", "top-right", "top-left", "bottom-1", "bottom-3", "top-3", "top-1"] as const;
type Spot = (typeof SPOTS)[number];

function rectAt(spot: Spot, size: { w: number; h: number }, w: number, h: number): Rect {
  const y = spot.startsWith("top") ? EDGE : size.h - EDGE - h;
  const x = spot.endsWith("left") ? EDGE : spot.endsWith("right") ? size.w - EDGE - w
    : Math.min(size.w - EDGE - w, Math.max(EDGE, (size.w * (spot.endsWith("1") ? 1 : 3)) / 4 - w / 2));
  return { x, y, w, h };
}
/** The first place clear of everything in the first list of things to keep clear of that leaves one. */
function placeFor(avoid: Rect[][], size: { w: number; h: number }, w: number, h: number): { spot: Spot; r: Rect } | null {
  for (const tier of avoid) {
    for (const spot of SPOTS) { const r = rectAt(spot, size, w, h); if (!tier.some((a) => meets(a, r))) return { spot, r }; }
  }
  return null;
}
// Held by the edge it is at, so growing as the words come in moves it away from that edge.
const styleAt = ({ spot, r }: { spot: Spot; r: Rect }) => (spot.startsWith("top") ? { left: r.x, top: EDGE } : { left: r.x, bottom: EDGE });

/**
 * What the studio's own model is thinking and writing as it works, over the canvas, for a
 * person who closed the chat to watch the pattern. It keeps out of the way of the selection,
 * shrinks to a dot, and closes for the rest of a run.
 */
export function ModelBubble({ live, step, size, avoid, small, onSmall, onClose, onOpenChat }: {
  live: AgentLive; step: AgentCall | null; size: { w: number; h: number }; avoid: Rect[][];
  small: boolean; onSmall: (small: boolean) => void; onClose: () => void; onOpenChat?: () => void;
}) {
  const [tall, setTall] = useState(132);
  const measured = useCallback((e: HTMLDivElement | null) => {
    if (!e) return;
    const ro = new ResizeObserver(() => setTall(e.offsetHeight));
    ro.observe(e);
    return () => ro.disconnect();
  }, []);
  // Taller than it may be, its oldest words fade out at the top.
  const [over, setOver] = useState(false);
  const fits = useCallback((e: HTMLDivElement | null) => {
    if (!e) return;
    const ro = new ResizeObserver(() => { const words = e.firstElementChild as HTMLElement | null; setOver(!!words && words.offsetHeight > e.clientHeight + 1); });
    ro.observe(e);
    if (e.firstElementChild) ro.observe(e.firstElementChild);
    return () => ro.disconnect();
  }, []);
  // No room beside the selection, so a dot; pressed, it opens there anyway, until made small.
  const [anyway, setAnyway] = useState(false);

  const status = live.ended === "done" ? "Finished" : live.ended === "cancelled" ? "Stopped" : live.ended === "failed" ? "Could not finish"
    : step ? step.summary : live.kind === "text" ? "Writing its answer" : "Thinking";
  const working = !live.ended;
  const w = Math.min(WIDE, size.w - 2 * EDGE);
  const roomy = small ? null : placeFor(avoid, size, w, tall);
  const full = roomy ?? (!small && anyway ? { spot: "bottom-left" as const, r: rectAt("bottom-left", size, w, tall) } : null);
  // Long, it starts at a word: what came before went by already.
  const text = live.text.length >= 600 ? live.text.slice(live.text.search(/\s/) + 1) : live.text;

  if (!full) {
    const crowded = !small;
    const at = placeFor([avoid[avoid.length - 1] ?? []], size, DOT, DOT) ?? { spot: "bottom-left" as const, r: rectAt("bottom-left", size, DOT, DOT) };
    return (
      <Tooltip label={`${live.client}: ${status}`} hint={crowded ? "There is no room for it beside what you have selected. Press to open it anyway." : "Press to see what it is thinking."} side="top">
        <button type="button" className="model-dot" data-testid="model-bubble-dot" aria-label={`${live.client}: ${status}. Show what it is thinking.`}
          onClick={() => (crowded ? setAnyway(true) : onSmall(false))} style={styleAt(at)}>
          <span aria-hidden className={working ? "working" : undefined} />
        </button>
      </Tooltip>
    );
  }
  return (
    <div ref={measured} role="group" aria-label="What your model is thinking" data-testid="model-bubble" className="model-bubble" data-ended={live.ended}
      style={{ ...styleAt(full), width: w }}>
      <div className="model-bubble-head">
        <span aria-hidden className={working ? "working model-bubble-dot" : "model-bubble-dot"} />
        <span className="model-bubble-who">
          <strong>{live.client}</strong>
          <span className="model-bubble-status">{status}</span>
        </span>
        {onOpenChat && <IconButton label="Open the chat" hint="All of what it said, and what you asked, in the Ask panel." onClick={onOpenChat}><Sparkles size={14} /></IconButton>}
        <IconButton label="Make it small" hint="A dot until you press it. It stays small next time." onClick={() => { setAnyway(false); onSmall(true); }}><Minimize2 size={14} /></IconButton>
        <IconButton label="Close" hint="Hidden until your model starts on something new." onClick={onClose}><X size={14} /></IconButton>
      </div>
      {text && <div ref={fits} className="model-bubble-text" data-kind={live.kind} data-over={over || undefined}><Markdown text={text} topLevel={4} /></div>}
    </div>
  );
}
