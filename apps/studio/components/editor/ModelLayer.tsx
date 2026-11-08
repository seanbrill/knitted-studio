"use client";

import { useEffect, useState } from "react";
import { bounds, union, type Box, type Stitch } from "@knitted/core";
import { Tip, icons } from "@knitted/ui";
import { marksOn, useAgent, useNow } from "@/lib/agent";
import { ENDED_MS, focusOn, liveOn, meets, stepOf, workOn, type Rect } from "@/lib/editor/live";
import { ModelBubble } from "./ModelBubble";
import { useFollow } from "@/lib/follow";

const { ArrowLeft } = icons;
const BUBBLE_KEY = "knitted.editor.bubble";
const HANDLE_AT: [number, number][] = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];
const grow = (r: Rect, side: number, top = side, bottom = side): Rect => ({ x: r.x - side, y: r.y - top, w: r.w + 2 * side, h: r.h + top + bottom });
/** Where a selection's handles are, the rotate one above it included: what is never covered. */
const handlesOf = (r: Rect): Rect[] => [...HANDLE_AT.map(([fx, fy]) => ({ x: r.x + fx * r.w - 10, y: r.y + fy * r.h - 10, w: 20, h: 20 })), { x: r.x + r.w / 2 - 10, y: r.y - 38, w: 20, h: 20 }];

/**
 * Where a model works on the open pattern, over the canvas: the frame outlined while one is at
 * work on it, the stitches it is changing outlined in the model's red with its name, a way to
 * them when they are out of sight, and what the studio's own model is thinking (ModelBubble).
 * A component of its own, so a model's every word draws this again and not the canvas.
 */
export function ModelLayer({ patternId, stitches, box, scale, at, size, frame, selection, onShow, chatOpen, onOpenChat }: {
  patternId: string; stitches: Stitch[]; box: (s: Stitch) => Box; scale: number; at: { x: number; y: number };
  size: { w: number; h: number }; frame: { w: number; h: number }; selection: Rect | null;
  onShow: (r: Rect) => void; chatOpen: boolean; onOpenChat?: () => void;
}) {
  const agent = useAgent();
  const live = liveOn(agent, patternId);
  const now = useNow((t) => !!workOn(agent, patternId, t) || (!!live?.ended && t - Date.parse(live.at) < ENDED_MS), 500);
  const work = workOn(agent, patternId, now);
  const marks = marksOn(agent, patternId, now);
  const focus = focusOn(agent, patternId, now);

  // Small is remembered; closed is for one run, and the next one opens it again.
  const [small, setSmall] = useState(false);
  useEffect(() => {
    // Read after mount on purpose, as AppShell does: the server cannot know this preference.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setSmall(localStorage.getItem(BUBBLE_KEY) === "small"); } catch {}
  }, []);
  const shrink = (v: boolean) => { setSmall(v); try { localStorage.setItem(BUBBLE_KEY, v ? "small" : "full"); } catch {} };
  const [closed, setClosed] = useState<string | null>(null);
  // Not while the chat is open: it shows the same words, and more of them.
  const bubble = live && !chatOpen && closed !== live.jobId && !(live.ended && now - Date.parse(live.at) >= ENDED_MS) ? live : null;

  const v = (b: Box): Rect => ({ x: at.x + b.x * scale, y: at.y + b.y * scale, w: b.w * scale, h: b.h * scale });
  const marked = marks ? stitches.filter((s) => marks.ids.includes(s.id)) : [];
  // Its newest change is drawn strongest, with its name; what it changed a moment before, fainter.
  const lead = marked.filter((s) => focus.includes(s.id));
  const named = (lead[0] ?? marked[0])?.id;
  const spotBox = union((lead.length ? lead : marked).map((s) => bounds(box(s))));
  const spot = spotBox ? v(spotBox) : null;
  const away = spot && !meets(spot, { x: 0, y: 0, w: size.w, h: size.h }) ? spot : null;
  let pointer: { left: number; top: number; w: number; h: number; turn: number } | null = null;
  if (away) {
    const w = Math.min(260, size.w - 24), h = 30;
    const cx = away.x + away.w / 2, cy = away.y + away.h / 2;
    const left = Math.min(size.w - w - 12, Math.max(12, cx - w / 2)), top = Math.min(size.h - h - 12, Math.max(12, cy - h / 2));
    pointer = { left, top, w, h, turn: (Math.atan2(cy - (top + h / 2), cx - (left + w / 2)) * 180) / Math.PI - 180 };
  }
  // Following, the canvas goes to what it changes when that is out of sight, each time it moves on.
  const following = useFollow((f) => f.on);
  const goTo = (lead.length ? lead : marked).map((s) => s.id).join(",");
  useEffect(() => {
    if (following && away) onShow(away);
  }, [following, goTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // The frame says who is at work when nothing it changes is drawn, and the bubble does not say it already.
  const tagged = !!work && !marked.length && !(bubble && !small && bubble.client === work.who);
  const tag: Rect | null = tagged ? { x: Math.max(8, at.x - 2), y: Math.max(8, at.y - 28), w: Math.min(360, size.w - 16), h: 22 } : null;

  // The bubble keeps clear of what it can, most of all the selection's handles.
  const sel = selection ? grow(selection, 14, 44, 14) : null;
  const avoid: Rect[][] = [
    [...(sel ? [sel] : []), ...marked.map((s) => grow(v(bounds(box(s))), 4, 24, 4)), ...(tag ? [tag] : []), ...(pointer ? [{ x: pointer.left, y: pointer.top, w: pointer.w, h: pointer.h }] : [])],
    sel ? [sel] : [],
    selection ? handlesOf(selection) : [],
  ];

  // Said to a screen reader: each note when it is finished, then how the run ended. Not the words as they come.
  const heard = !live || chatOpen || closed === live.jobId ? ""
    : live.ended === "cancelled" ? "Your model stopped."
    : live.ended === "failed" ? "Your model could not finish. The chat says why."
    : live.done && live.text ? `${live.kind === "note" ? `${live.client} thought` : `${live.client} answered`}: ${live.text}` : "";

  return (
    <div className="model-layer">
      {work && <div aria-hidden className="model-frame" data-running={work.running || undefined} style={{ left: at.x - 5, top: at.y - 5, width: frame.w + 10, height: frame.h + 10 }} />}
      {tag && work && (
        <span aria-hidden className="model-tag" style={{ left: tag.x, top: tag.y, maxWidth: tag.w }}>
          {work.running && <span className="working model-tag-dot" />}
          <strong>{work.who}</strong>
          <span className="model-tag-what">{work.what}</span>
        </span>
      )}
      {marked.map((s) => {
        const b = box(s);
        return (
          <div key={`model-${s.id}`} data-testid={`model-${s.id}`} aria-hidden className="model-mark" data-lead={!lead.length || lead.includes(s) ? undefined : "false"}
            style={{ left: at.x + b.x * scale, top: at.y + b.y * scale, width: b.w * scale, height: b.h * scale, transform: `rotate(${b.rotate ?? 0}deg)` }}>
            {s.id === named && (
              <span className="model-tag model-mark-tag">
                {marks!.running && <span className="working model-tag-dot" />}
                {marks!.who}
              </span>
            )}
          </div>
        );
      })}
      {pointer && marks && (
        <Tip text="Moves the canvas to what it is changing.">
          <button type="button" className="model-pointer" onClick={() => onShow(away!)} style={{ left: pointer.left, top: pointer.top, maxWidth: pointer.w }}>
            <ArrowLeft size={14} aria-hidden style={{ transform: `rotate(${pointer.turn}deg)`, flexShrink: 0 }} />
            <span className="model-pointer-text">Show where {marks.who} is working</span>
          </button>
        </Tip>
      )}
      {bubble && (
        <ModelBubble live={bubble} step={stepOf(agent, bubble)} size={size} avoid={avoid} small={small} onSmall={shrink}
          onClose={() => setClosed(bubble.jobId)} onOpenChat={onOpenChat} />
      )}
      <div className="sr-only" aria-live="polite">{heard}</div>
    </div>
  );
}
