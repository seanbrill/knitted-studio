"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { yarnFileUrl, yarnThumbUrl } from "@knitted/core/client";
import { bounds, center, intersects, resizeBox, rotatePt, snapMove, toFrac, toPx, union, angleTo, type Box, type Command, type Guide, type Handle, type Stitch } from "@knitted/core";
import { bodyHtml, pageFor } from "@knitted/render/pure";
import { liveStitches, useEditor, ZOOM_MAX, ZOOM_MIN } from "@/lib/editor/store";
import { useSpaceHeld, wheelZoom } from "@/lib/zoom";
import { resolveStyle, compileMotion } from "@knitted/core";
import type { Rect } from "@/lib/editor/live";
import { ModelLayer } from "./ModelLayer";

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSOR: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
const HANDLE_POS: Record<Handle, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const SNAP_PX = 6;

// The canvas moves about the frame, and the frame never goes out of reach: on a side where it
// fits, it sits in the middle; where it does not, its edge comes this far in at most.
const PAD = 48;
// A scroll moves the canvas a little less than the system would move a page: the frame is
// placed by eye. How far a pinch zooms is wheelZoom's, the same on a design sheet.
const PAN_RATE = 0.85;

type Gesture =
  | { kind: "move"; start: { x: number; y: number }; orig: Record<string, Box>; moved: boolean }
  | { kind: "resize"; handle: Handle; start: { x: number; y: number }; orig: Record<string, Box>; group: Box; shift: boolean }
  | { kind: "rotate"; id: string; c: { x: number; y: number }; origStyle: Stitch["style"] }
  | { kind: "marquee"; start: { x: number; y: number }; additive: boolean; base: string[] };

type Point = { x: number; y: number };

export function Canvas({ projectId, chatOpen, onOpenChat }: { projectId: string; chatOpen?: boolean; onOpenChat?: () => void }) {
  const st = useEditor();
  const { pattern, swatch, yarn, parts, mode, selection, draft } = st;
  const W = pattern.size.w, H = pattern.size.h;
  const view = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const frameEl = useRef<HTMLIFrameElement>(null);
  const [box, setBox] = useState({ w: 900, h: 600 });
  const [ready, setReady] = useState(false);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    const el = view.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const fit = Math.min(1, Math.max(0.05, Math.min((box.w - 2 * PAD) / W, (box.h - 2 * PAD) / H)));
  const scale = st.zoom === "fit" ? fit : st.zoom;
  useEffect(() => { useEditor.getState().setFitScale(fit); }, [fit]);

  // ── where the frame is: its top-left corner in the canvas, null for the middle ──
  const [pan, setPan] = useState<Point | null>(null);
  // A place on the frame, in its own pixels, to bring to the middle once a zoom to it is drawn.
  const [focus, setFocus] = useState<Point | null>(null);
  const place = useCallback((p: Point | null, s: number): Point => {
    const axis = (v: number | undefined, a: number, room: number) => (v === undefined || a + 2 * PAD <= room ? (room - a) / 2 : Math.min(PAD, Math.max(room - PAD - a, v)));
    return { x: axis(p?.x, W * s, box.w), y: axis(p?.y, H * s, box.h) };
  }, [W, H, box.w, box.h]);
  // A zoom keeps the point under the pointer where it is: the middle, for the buttons and keys.
  const [anchor, setAnchor] = useState<Point | null>(null);
  const [drawnAt, setDrawnAt] = useState(scale);
  if (drawnAt !== scale) {
    setDrawnAt(scale); setAnchor(null);
    if (focus) { setFocus(null); setPan(place({ x: box.w / 2 - focus.x * scale, y: box.h / 2 - focus.y * scale }, scale)); }
    else if (st.zoom === "fit") setPan(null);
    else {
      const was = place(pan, drawnAt), a = anchor ?? { x: box.w / 2, y: box.h / 2 }, k = scale / drawnAt;
      setPan(place({ x: a.x - (a.x - was.x) * k, y: a.y - (a.y - was.y) * k }, scale));
    }
  }
  const at = place(pan, scale);
  // What the last drawing showed, for the handlers bound once.
  const shown = useRef({ at, scale, place });
  useLayoutEffect(() => { shown.current = { at, scale, place }; });

  const panBy = useCallback((dx: number, dy: number) => {
    setPan((p) => {
      const { place: pl, scale: s } = shown.current;
      const from = pl(p, s);
      return pl({ x: from.x + dx, y: from.y + dy }, s);
    });
  }, []);
  /** Bring a place on the canvas, as it is drawn now, to the middle: where a model works, say. */
  const panTo = useCallback((r: Rect) => {
    const { at: a, place: pl, scale: s } = shown.current;
    setPan(pl({ x: a.x + box.w / 2 - (r.x + r.w / 2), y: a.y + box.h / 2 - (r.y + r.h / 2) }, s));
  }, [box.w, box.h]);

  // Every wheel over the canvas is the canvas's: the page under it never zooms or scrolls with it.
  useEffect(() => {
    const el = view.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      let dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        const z = useEditor.getState();
        const now = z.zoom === "fit" ? z.fitScale : z.zoom;
        const next = wheelZoom(now, dy, ZOOM_MIN, ZOOM_MAX);
        if (next === now) return;
        const r = el.getBoundingClientRect();
        setAnchor({ x: e.clientX - r.left, y: e.clientY - r.top });
        z.setZoom(next);
        return;
      }
      // A mouse wheel with Shift held goes sideways.
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      panBy(-dx * PAN_RATE, -dy * PAN_RATE);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [panBy]);

  // Dragging the space around the frame, dragging anywhere with the middle button, or anywhere
  // at all with Space held or the hand on, moves the canvas.
  const space = useSpaceHeld();
  const handy = st.hand || space;
  const drag = useRef<{ id: number; x: number; y: number; from: Point; moved: boolean; hand: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const panDown = (e: React.PointerEvent) => {
    if (!(e.button === 1 || (e.button === 0 && (handy || e.target === e.currentTarget)))) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: at, moved: false, hand: handy };
  };
  // With the hand, a press on the frame is the canvas's, not a stitch's: taken before the frame sees it.
  const handDown = (e: React.PointerEvent) => {
    if (!handy || e.button !== 0 || editing) return;
    e.stopPropagation();
    panDown(e);
  };
  const panMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    if (!d.moved) { d.moved = true; setDragging(true); }
    setPan(place({ x: d.from.x + dx, y: d.from.y + dy }, scale));
  };
  const panUp = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    drag.current = null; setDragging(false);
    // A click on the space around the frame, not a drag, lets go of what is selected.
    if (!d.moved && e.button === 0 && !editing && !d.hand) st.select([]);
  };

  // Zoom to selection: what is selected, as big as the canvas holds it, in the middle.
  const zoomAsk = st.zoomAsk;
  useEffect(() => {
    if (!zoomAsk) return;
    const u = union(liveStitches(useEditor.getState()).filter((s) => zoomAsk.ids.includes(s.id)).map(stitchBox));
    if (!u) return;
    const want = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min((box.w - 2 * PAD) / Math.max(u.w, 1), (box.h - 2 * PAD) / Math.max(u.h, 1))));
    const c = { x: u.x + u.w / 2, y: u.y + u.h / 2 };
    if (Math.abs(want - shown.current.scale) < 1e-6) setPan(shown.current.place({ x: box.w / 2 - c.x * want, y: box.h / 2 - c.y * want }, want));
    else { setFocus(c); useEditor.getState().setZoom(want); }
  }, [zoomAsk?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the page in the iframe: the SAME renderer the engine uses ──────────────
  const ctx = useMemo(() => ({
    swatch, mode: "edit" as const,
    yarn: (id: string) => { const y = yarn[id]; return y ? { url: yarnFileUrl(y), kind: y.kind, mime: y.mime, width: y.width, height: y.height, meta: y.meta, posterUrl: y.meta.thumb ? yarnThumbUrl(y) : undefined } : undefined; },
    part: (id: string) => parts[id],
    fontFaces: `@import url("/api/projects/${projectId}/fonts.css");`,
  }), [swatch, yarn, parts, projectId]);
  // Rebuilt only when the frame changes shape: content is pushed into it live, not by reloading it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const srcDoc = useMemo(() => pageFor({ ...pattern, stitches: [], durationMs: 0 }, ctx), [W, H, projectId]);
  useEffect(() => setReady(false), [srcDoc]);

  const stitches = liveStitches({ pattern, draft });
  const raf = useRef(0);
  // Scrubbing and playing move the clock without redrawing anything.
  useEffect(() => {
    if (!ready) return;
    (frameEl.current?.contentWindow as (Window & { __stage?: { seek(ms: number): void } }) | null)?.__stage?.seek(st.playhead);
  }, [st.playhead, ready]);
  // Drawn again when what is drawn changes, not when the canvas moves or the pointer passes over it.
  useEffect(() => {
    if (!ready) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const w = frameEl.current?.contentWindow as (Window & { __edit?: { set(html: string, css?: string): void }; __stage?: { seek(ms: number): void } }) | null;
      w?.__edit?.set(bodyHtml({ ...pattern, stitches }, ctx), compileMotion({ stitches, motion: pattern.motion }));
      w?.__stage?.seek(useEditor.getState().playhead);
    });
    return () => cancelAnimationFrame(raf.current);
  }, [ready, pattern, draft, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  const stitchBox = useCallback((s: Stitch): Box => toPx(s, pattern.size, Number(resolveStyle(swatch, s.style).rotate ?? 0)), [pattern.size, swatch]);
  const hittable = (s: Stitch) => !(resolveStyle(swatch, s.style).hidden) && !(mode === "fill" && s.locked);

  const toFrame = (e: { clientX: number; clientY: number }) => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const hitTest = (p: { x: number; y: number }): Stitch | null => {
    for (let i = stitches.length - 1; i >= 0; i--) {
      const s = stitches[i]; if (!hittable(s)) continue;
      const b = stitchBox(s); const q = rotatePt(p, -(b.rotate ?? 0), center(b));
      if (q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h) return s;
    }
    return null;
  };

  const selected = stitches.filter((s) => selection.includes(s.id));
  const group: Box | null = useMemo(() => union(selected.map(stitchBox)), [selected, stitchBox]);

  // ── gestures ───────────────────────────────────────────────────────────────
  const down = (e: React.PointerEvent) => {
    if (editing || e.button !== 0) return;
    overlay.current!.setPointerCapture(e.pointerId);
    const p = toFrame(e);
    const hit = hitTest(p);
    if (hit) {
      let ids = selection;
      if (e.shiftKey) ids = selection.includes(hit.id) ? selection.filter((x) => x !== hit.id) : [...selection, hit.id];
      else if (!selection.includes(hit.id)) ids = [hit.id];
      st.select(ids);
      if (!ids.includes(hit.id)) return;
      const orig: Record<string, Box> = {};
      for (const s of stitches) if (ids.includes(s.id)) orig[s.id] = stitchBox(s);
      setGesture({ kind: "move", start: p, orig, moved: false });
    } else {
      if (!e.shiftKey) st.select([]);
      setGesture({ kind: "marquee", start: p, additive: e.shiftKey, base: e.shiftKey ? selection : [] });
    }
  };

  const startResize = (e: React.PointerEvent, handle: Handle) => {
    e.stopPropagation(); overlay.current!.setPointerCapture(e.pointerId);
    const orig: Record<string, Box> = {};
    for (const s of selected) orig[s.id] = stitchBox(s);
    setGesture({ kind: "resize", handle, start: toFrame(e), orig, group: group!, shift: e.shiftKey });
  };
  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation(); overlay.current!.setPointerCapture(e.pointerId);
    const s = selected[0];
    setGesture({ kind: "rotate", id: s.id, c: center(stitchBox(s)), origStyle: s.style });
  };

  const move = (e: React.PointerEvent) => {
    const p = toFrame(e);
    if (!gesture) { const h = hitTest(p); setHover(h?.id ?? null); return; }
    if (gesture.kind === "move") {
      let dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) * scale < 3) return;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const ids = Object.keys(gesture.orig);
      const g0 = union(Object.values(gesture.orig))!;
      const others = stitches.filter((s) => !ids.includes(s.id)).map((s) => bounds(stitchBox(s)));
      const sn = snapMove({ ...g0, x: g0.x + dx, y: g0.y + dy }, others, pattern.size, SNAP_PX / scale);
      dx += sn.dx; dy += sn.dy;
      setGuides(sn.guides);
      const d: Record<string, Partial<Stitch>> = {};
      for (const id of ids) { const o = gesture.orig[id]; Object.assign(d, { [id]: toFrac({ ...o, x: o.x + dx, y: o.y + dy }, pattern.size) as Partial<Stitch> }); (d[id] as Partial<Stitch>) = { x: d[id].x, y: d[id].y }; }
      st.setDraft(d); if (!gesture.moved) setGesture({ ...gesture, moved: true });
    } else if (gesture.kind === "resize") {
      const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
      const ids = Object.keys(gesture.orig);
      const d: Record<string, Partial<Stitch>> = {};
      if (ids.length === 1) {
        const o = gesture.orig[ids[0]];
        const isText = stitches.find((s) => s.id === ids[0])?.kind === "text";
        const nb = resizeBox(o, gesture.handle, dx, dy, { keepAspect: e.shiftKey && !isText, fromCenter: e.altKey });
        d[ids[0]] = toFrac(nb, pattern.size);
      } else {
        const nb = resizeBox({ ...gesture.group, rotate: 0 }, gesture.handle, dx, dy, { keepAspect: true });
        const g = gesture.group, fx = nb.w / g.w, fy = nb.h / g.h;
        for (const id of ids) { const o = gesture.orig[id]; d[id] = toFrac({ x: nb.x + (o.x - g.x) * fx, y: nb.y + (o.y - g.y) * fy, w: o.w * fx, h: o.h * fy }, pattern.size); }
      }
      st.setDraft(d);
    } else if (gesture.kind === "rotate") {
      const a = angleTo(gesture.c, p, e.shiftKey ? 15 : 0);
      st.setDraft({ [gesture.id]: { style: { ...(gesture.origStyle ?? {}), rotate: a } } });
    } else if (gesture.kind === "marquee") {
      const x = Math.min(p.x, gesture.start.x), y = Math.min(p.y, gesture.start.y);
      const m = { x, y, w: Math.abs(p.x - gesture.start.x), h: Math.abs(p.y - gesture.start.y) };
      setMarquee(m);
      const hit = stitches.filter((s) => hittable(s) && intersects(bounds(stitchBox(s)), m)).map((s) => s.id);
      st.select([...new Set([...gesture.base, ...hit])]);
    }
  };

  const up = () => {
    const g = gesture; setGesture(null); setMarquee(null); setGuides([]);
    if (!g) return;
    const d = useEditor.getState().draft; st.setDraft(null);
    if (!d || !Object.keys(d).length) return;
    const commands: Command[] = Object.entries(d).map(([id, patch]) => ({ type: "updateStitch", id, patch: patch as never }));
    st.dispatch(commands.length === 1 ? commands[0] : { type: "batch", commands }, { label: g.kind === "move" ? "Move" : g.kind === "resize" ? "Resize" : "Rotate" });
  };

  // ── dropping Yarn on the canvas ────────────────────────────────────────────
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData("application/x-knitted-yarn"); if (!id) return;
    e.preventDefault();
    const y = yarn[id]; if (!y || (y.kind !== "image" && y.kind !== "video")) return;
    const p = toFrame(e);
    const target = hitTest(p);
    if (target && (target.kind === "image" || target.kind === "video")) { st.dispatch({ type: "updateStitch", id: target.id, patch: { yarnId: id } }, { label: "Set image" }); st.select([target.id]); return; }
    const w = 0.5, ratio = (y.width && y.height ? y.width / y.height : 1), h = (w * W) / ratio / H;
    const sid = `st_${Math.random().toString(36).slice(2, 9)}`;
    st.dispatch({ type: "addStitch", stitch: { id: sid, kind: y.kind === "video" ? "video" : "image", x: Math.min(0.9, Math.max(0, p.x / W - w / 2)), y: Math.min(0.9, Math.max(0, p.y / H - h / 2)), w, h, locked: false, yarnId: id, style: { fit: "cover" } } }, { label: "Add image" });
    st.select([sid]);
  };

  // ── drawing the overlay ────────────────────────────────────────────────────
  const single = selected.length === 1 ? selected[0] : null;
  const showHandles = !!group && mode !== "fill" ? true : !!group && !selected.some((s) => s.locked);
  const outline = (s: Stitch, kind: "hover" | "select") => {
    const b = stitchBox(s);
    return (
      <div key={`${kind}-${s.id}`} data-testid={`outline-${s.id}`} aria-hidden style={{ position: "absolute", left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale, transform: `rotate(${b.rotate ?? 0}deg)`, pointerEvents: "none",
        border: kind === "hover" && !selection.includes(s.id) ? "1px solid var(--ember)" : s.locked ? "1.5px dashed var(--ember)" : kind === "select" ? "2px solid var(--ember)" : "1px solid var(--line-strong)" }} />
    );
  };
  // The selection as drawn now: what the model's bubble keeps clear of.
  const selRect: Rect | null = group ? { x: at.x + group.x * scale, y: at.y + group.y * scale, w: group.w * scale, h: group.h * scale } : null;

  // How far the canvas goes, as thin bars at its edges: shown on a side only when it can move that way.
  const room = { w: W * scale + 2 * PAD, h: H * scale + 2 * PAD };
  const barX = room.w > box.w + 0.5 ? { left: ((PAD - at.x) / room.w) * box.w, width: (box.w / room.w) * box.w } : null;
  const barY = room.h > box.h + 0.5 ? { top: ((PAD - at.y) / room.h) * box.h, height: (box.h / room.h) * box.h } : null;

  return (
    <div ref={view} data-testid="canvas-view" className="canvas-view" data-dragging={dragging || undefined} data-hand={handy || undefined}
      onPointerDownCapture={handDown} onPointerDown={panDown} onPointerMove={panMove} onPointerUp={panUp} onPointerCancel={panUp} onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
      onDoubleClick={(e) => { if (e.target === e.currentTarget && !handy) { st.setZoom("fit"); setPan(null); } }}
      style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", background: "var(--surface-sunken)", position: "relative", touchAction: "none", overscrollBehavior: "none" }}>
      <div data-testid="canvas-frame" style={{ position: "absolute", left: 0, top: 0, width: W * scale, height: H * scale, transform: `translate(${at.x}px, ${at.y}px)`, boxShadow: "var(--shadow-lift)", borderRadius: 2 }}>
        <iframe ref={frameEl} title="Pattern canvas" srcDoc={srcDoc} onLoad={() => setReady(true)} tabIndex={-1}
          style={{ position: "absolute", left: 0, top: 0, width: W, height: H, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", background: "var(--surface-raised)", pointerEvents: "none" }} />
        <div ref={overlay} data-testid="canvas-overlay" role="application" aria-label="Pattern canvas"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onDoubleClick={(e) => { const h = hitTest(toFrame(e)); if (h?.kind === "text") { setEditing(h.id); st.select([h.id]); } }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-knitted-yarn")) e.preventDefault(); }} onDrop={onDrop}
          style={{ position: "absolute", inset: 0, touchAction: "none", cursor: handy ? "inherit" : gesture?.kind === "move" ? "grabbing" : hover ? "move" : "default" }}>
          {hover && !gesture && stitches.filter((s) => s.id === hover).map((s) => outline(s, "hover"))}
          {stitches.filter((s) => s.locked && !selection.includes(s.id) && !(resolveStyle(swatch, s.style).hidden)).map((s) => {
            const b = stitchBox(s);
            return <div key={`lock-${s.id}`} aria-hidden style={{ position: "absolute", left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale, transform: `rotate(${b.rotate ?? 0}deg)`, border: "1.5px dashed var(--ember)", opacity: 0.55, pointerEvents: "none", borderRadius: 2 }} />;
          })}
          {selected.map((s) => outline(s, "select"))}
          {group && showHandles && !editing && (
            <div aria-hidden style={{ position: "absolute", left: group.x * scale, top: group.y * scale, width: group.w * scale, height: group.h * scale, transform: single ? `rotate(${stitchBox(single).rotate ?? 0}deg)` : undefined, pointerEvents: "none" }}>
              {HANDLES.map((h) => {
                const [fx, fy] = HANDLE_POS[h];
                return <span key={h} data-handle={h} onPointerDown={(e) => startResize(e, h)} style={{ position: "absolute", left: `${fx * 100}%`, top: `${fy * 100}%`, width: 12, height: 12, margin: -6, background: "var(--surface-raised)", border: "2px solid var(--ember)", borderRadius: 3, cursor: CURSOR[h], pointerEvents: "auto" }} />;
              })}
              {single && <span data-handle="rotate" onPointerDown={startRotate} style={{ position: "absolute", left: "50%", top: -28, width: 12, height: 12, margin: "-6px 0 0 -6px", background: "var(--ember)", borderRadius: "50%", cursor: "grab", pointerEvents: "auto" }} />}
            </div>
          )}
          {guides.map((g, i) => <div key={i} aria-hidden style={{ position: "absolute", background: "#e5484d", ...(g.axis === "x" ? { left: g.pos * scale, top: 0, bottom: 0, width: 1 } : { top: g.pos * scale, left: 0, right: 0, height: 1 }) }} />)}
          {marquee && <div aria-hidden style={{ position: "absolute", left: marquee.x * scale, top: marquee.y * scale, width: marquee.w * scale, height: marquee.h * scale, background: "var(--tint)", border: "1px solid var(--ember)" }} />}
          {editing && <TextEditor id={editing} scale={scale} onDone={() => setEditing(null)} />}
        </div>
      </div>
      <ModelLayer patternId={pattern.id} stitches={stitches} box={stitchBox} scale={scale} at={at} size={box} frame={{ w: W * scale, h: H * scale }}
        selection={editing ? null : selRect} onShow={panTo} chatOpen={!!chatOpen} onOpenChat={onOpenChat} />
      {barX && <span aria-hidden className="canvas-bar canvas-bar-x" style={{ left: Math.max(0, barX.left), width: barX.width }} />}
      {barY && <span aria-hidden className="canvas-bar canvas-bar-y" style={{ top: Math.max(0, barY.top), height: barY.height }} />}
      <output className="sr-only" aria-live="polite">{selected.length ? `${selected.length} selected: ${selected.map((s) => s.slot ?? s.kind).join(", ")}` : "Nothing selected"}</output>
    </div>
  );
}

/** Edit text in place with a real textarea, so IME composition, selection and paste all behave natively. */
function TextEditor({ id, scale, onDone }: { id: string; scale: number; onDone: () => void }) {
  const { pattern, swatch, dispatch } = useEditor();
  const s = pattern.stitches.find((x) => x.id === id);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [val, setVal] = useState(s?.content ?? "");
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  if (!s) return null;
  const st = resolveStyle(swatch, s.style);
  const b = toPx(s, pattern.size);
  const commit = () => { if (val !== (s.content ?? "")) dispatch({ type: "updateStitch", id, patch: { content: val } }, { label: "Edit text" }); onDone(); };
  return (
    <textarea ref={ref} aria-label="Edit text" value={val} onChange={(e) => setVal(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onDone(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit(); }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ position: "absolute", left: b.x * scale, top: b.y * scale, width: b.w * scale, minHeight: b.h * scale, resize: "none", padding: 0, margin: 0, border: "2px solid var(--ember)", outline: "none", background: "rgba(255,255,255,.88)", color: "#17110b",
        fontFamily: `"${st.fontFamily ?? "Geist"}", sans-serif`, fontSize: Number(st.fontSize ?? 0.05) * pattern.size.w * scale, fontWeight: Number(st.fontWeight ?? 700), lineHeight: Number(st.lineHeight ?? 1.05), letterSpacing: `${Number(st.letterSpacing ?? -0.02)}em` }} />
  );
}
