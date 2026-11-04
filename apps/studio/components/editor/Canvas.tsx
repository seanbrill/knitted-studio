"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { yarnFileUrl, yarnThumbUrl } from "@knitted/core/client";
import { bounds, center, intersects, resizeBox, rotatePt, snapMove, toFrac, toPx, union, angleTo, type Box, type Command, type Guide, type Handle, type Stitch } from "@knitted/core";
import { bodyHtml, pageFor } from "@knitted/render/pure";
import { liveStitches, useEditor } from "@/lib/editor/store";
import { marksOn, useAgent, useNow } from "@/lib/agent";
import { resolveStyle, compileMotion } from "@knitted/core";

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSOR: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
const HANDLE_POS: Record<Handle, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const SNAP_PX = 6;

type Gesture =
  | { kind: "move"; start: { x: number; y: number }; orig: Record<string, Box>; moved: boolean }
  | { kind: "resize"; handle: Handle; start: { x: number; y: number }; orig: Record<string, Box>; group: Box; shift: boolean }
  | { kind: "rotate"; id: string; c: { x: number; y: number }; origStyle: Stitch["style"] }
  | { kind: "marquee"; start: { x: number; y: number }; additive: boolean; base: string[] };

export function Canvas({ projectId }: { projectId: string }) {
  const st = useEditor();
  const { pattern, swatch, yarn, parts, mode, selection, draft } = st;
  const W = pattern.size.w, H = pattern.size.h;
  const wrap = useRef<HTMLDivElement>(null);
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
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const scale = st.zoom === "fit" ? Math.min(1, Math.max(0.05, Math.min((box.w - 96) / W, (box.h - 96) / H))) : st.zoom;

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
  useEffect(() => {
    if (!ready) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const w = frameEl.current?.contentWindow as (Window & { __edit?: { set(html: string, css?: string): void }; __stage?: { seek(ms: number): void } }) | null;
      w?.__edit?.set(bodyHtml({ ...pattern, stitches }, ctx), compileMotion({ stitches, motion: pattern.motion }));
      w?.__stage?.seek(useEditor.getState().playhead);
    });
    return () => cancelAnimationFrame(raf.current);
  });

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

  return (
    <div ref={wrap} style={{ flex: 1, minWidth: 0, overflow: "auto", background: "var(--surface-sunken)", position: "relative" }} onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); st.setZoom(Math.min(4, Math.max(0.1, scale * (e.deltaY < 0 ? 1.1 : 0.9)))); } }}>
      <div style={{ minWidth: "100%", minHeight: "100%", display: "grid", placeItems: "center", padding: 48, width: "max-content" }}>
        <div style={{ position: "relative", width: W * scale, height: H * scale, boxShadow: "var(--shadow-lift)", borderRadius: 2 }}>
          <iframe ref={frameEl} title="Pattern canvas" srcDoc={srcDoc} onLoad={() => setReady(true)} tabIndex={-1}
            style={{ position: "absolute", left: 0, top: 0, width: W, height: H, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", background: "var(--surface-raised)", pointerEvents: "none" }} />
          <div ref={overlay} data-testid="canvas-overlay" role="application" aria-label="Pattern canvas"
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            onDoubleClick={(e) => { const h = hitTest(toFrame(e)); if (h?.kind === "text") { setEditing(h.id); st.select([h.id]); } }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-knitted-yarn")) e.preventDefault(); }} onDrop={onDrop}
            style={{ position: "absolute", inset: 0, touchAction: "none", cursor: gesture?.kind === "move" ? "grabbing" : hover ? "move" : "default" }}>
            {hover && !gesture && stitches.filter((s) => s.id === hover).map((s) => outline(s, "hover"))}
            {stitches.filter((s) => s.locked && !selection.includes(s.id) && !(resolveStyle(swatch, s.style).hidden)).map((s) => {
              const b = stitchBox(s);
              return <div key={`lock-${s.id}`} aria-hidden style={{ position: "absolute", left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale, transform: `rotate(${b.rotate ?? 0}deg)`, border: "1.5px dashed var(--ember)", opacity: 0.55, pointerEvents: "none", borderRadius: 2 }} />;
            })}
            <ModelMarks patternId={pattern.id} stitches={stitches} box={stitchBox} scale={scale} />
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
      </div>
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

/**
 * The stitches a model is changing, or changed a moment ago, outlined in red with its name,
 * so a person watching sees where it works and does not edit the same thing at once. Its
 * own component, so only it redraws as the moment passes.
 */
function ModelMarks({ patternId, stitches, box, scale }: { patternId: string; stitches: Stitch[]; box: (s: Stitch) => Box; scale: number }) {
  const agent = useAgent();
  const now = useNow((t) => !!marksOn(agent, patternId, t), 500);
  const marks = marksOn(agent, patternId, now);
  if (!marks) return null;
  return stitches.filter((s) => marks.ids.includes(s.id)).map((s, i) => {
    const b = box(s);
    return (
      <div key={`model-${s.id}`} data-testid={`model-${s.id}`} aria-hidden style={{ position: "absolute", left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale, transform: `rotate(${b.rotate ?? 0}deg)`, border: "2px solid var(--red)", borderRadius: 2, pointerEvents: "none" }}>
        {i === 0 && (
          <span style={{ position: "absolute", left: -2, bottom: "100%", marginBottom: 2, display: "inline-flex", alignItems: "center", gap: 5, background: "var(--red)", color: "var(--on-red)", fontSize: 11, fontWeight: 600, lineHeight: "16px", padding: "1px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>
            {marks.running && <span className="working" style={{ width: 6, height: 6, borderRadius: "50%" }} />}
            {marks.who}
          </span>
        )}
      </div>
    );
  });
}
