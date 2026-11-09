"use client";

// A design sheet, open: the board of sections and frames, zoomed to fit or to any size, and
// the selected frame's name, size and code beside it. Every change is saved as a version, so
// Undo walks back through the person's changes and their model's alike. While a model works
// on the sheet, its frames change here as it saves them.
//
// The board is laid out by layoutDesign (the same layout the sheet's pictures use) in the
// frames' own pixels, and only what is seen is loaded: a frame big enough on screen to read is
// drawn live, a smaller one is a picture of it the studio drew once, and one out of view is an
// outline. The sheet comes without its code; each frame's code is asked for when it is drawn
// live or picked, and a change brings back only the frames that changed.

import Link from "next/link";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, ApiError, subscribeChanges } from "@knitted/core/client";
import { DESIGN_DEVICES, BOARD, deviceOf, frameRev, frameSize, guessHeight, layoutDesign, lintDesignCode, type BoardLayout, type DesignDevice, type DesignFrame, type DesignMeta, type DesignOp, type FrameCode, type FrameMeta, type LaidFrame, type SectionMeta, type Swatch } from "@knitted/core";
import { Button, ConfirmDialog, Dialog, Field, IconButton, Input, Menu, SegmentedControl, Select, Textarea, Tip, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { brandKey, frameDoc, frameHeight, framePicUrl, hashOf } from "@/lib/design";
import { AskModelButton, aboutDesign } from "./AskModel";
import { ModelPresence } from "./ModelPresence";
import { ModelAtWork } from "./ModelAtWork";
import { ModelMark } from "./ModelMark";
import { leadOf, useMarks, type Mark } from "@/lib/agent";
import { ZoomControls } from "./ZoomControls";
import { CommentThreads, PinCatch, Pins, shownThreads, useCommentState, useComments, type CommentsOn } from "./Comments";
import { stepZoom, typingIn, useSpaceHeld, wheelZoom, zoomKey } from "@/lib/zoom";

const { ArrowLeft, ArrowUp, ArrowDown, ChevronRight, Copy, Download, FileCode, MessageSquare, MoreHorizontal, Package, Pencil, Plus, Trash2, Undo2, X, AlertTriangle } = icons;
const ZOOM_MIN = 0.02;
const ZOOM_MAX = 4;
// Round a frame zoomed to: room to see it is the whole frame, and its label.
const FRAME_ROOM = 48;
// Round the board at its fit: room on screen beside it, and above it for the section names.
const EDGE = 40;
const EDGE_TOP = 64;
// Somewhere on the board that is not a frame or a control: a drag there moves the board.
const NOT_EMPTY = ".design-frame-box, button, a, input, textarea, select, [role=menu]";
// What is drawn live: a frame at least this wide on screen, while pictures can be had, and no
// more than so many at once. Without pictures (no browser to draw them), more are live, and the
// rest are outlines.
const LIVE_MIN = 360;
const LIVE_MAX = 16;
const LIVE_MAX_BARE = 40;
// Below this zoom there is no room above a frame for its name.
const LABELS_MIN = 14 / BOARD.pad;
/** A section's name keeps its size on screen until it would not fit in the room between sections (about 44 pixels), then shrinks with the board. */
const HEAD_Z = 44 / BOARD.stack;
/** An empty section's "Add a frame" (about 180 by 136 pixels) fits the room inside it (400 by 160) the same way. */
const ADD_Z = 0.85;
const DEVICE_OPTIONS: { value: DesignDevice | "custom"; label: string }[] = [...(Object.keys(DESIGN_DEVICES) as DesignDevice[]).map((d) => ({ value: d, label: DESIGN_DEVICES[d].name })), { value: "custom", label: "Custom" }];

/** A new frame's code: a heading in the brand, to write over. */
const newFrameCode = (name: string, width: number) => ({
  html: `<main class="frame">\n  <h1>${name.replace(/[<>&]/g, "")}</h1>\n  <p>Write this frame's HTML here, or ask your model to design it.</p>\n</main>`,
  css: `.frame{padding:${width < 600 ? "48px 20px" : "96px 120px"}}\nh1{font:700 ${width < 600 ? 40 : 56}px/1.1 var(--font-display);margin:0 0 16px}\np{font-size:18px;max-width:640px}`,
});

interface Draft { name: string; width: number; height: number | null; note: string; html: string; css: string }
const draftOf = (f: DesignFrame): Draft => ({ name: f.name, width: f.width, height: f.height ?? null, note: f.note ?? "", html: f.html, css: f.css });
const same = (a: Draft, b: Draft) => (Object.keys(a) as (keyof Draft)[]).every((k) => a[k] === b[k]);

type Asking =
  | { kind: "section"; section?: SectionMeta }
  | { kind: "frame"; section: SectionMeta }
  | { kind: "delete-section"; section: SectionMeta };

/** How a frame is drawn now: live, as a picture, or as its outline. */
type Mode = "live" | "pic";
/** Part of the board, in the frames' pixels. */
interface Rect { x: number; y: number; w: number; h: number }

/** The sheet without its code, kept current: asked again when something changes, and only sent when it did. */
function useSheet(initial: DesignMeta) {
  const [design, setDesign] = useState(initial);
  const version = useRef(initial.version);
  const put = useCallback((d: DesignMeta) => { version.current = d.version; setDesign(d); }, []);
  const refresh = useCallback(async () => {
    try {
      const r = await api.designs.board(initial.id, version.current);
      if (!("same" in r)) put(r);
    } catch { /* the next change asks again */ }
  }, [initial.id, put]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeChanges(() => { clearTimeout(t); t = setTimeout(() => void refresh(), 150); });
    return () => { off(); clearTimeout(t); };
  }, [refresh]);
  return { design, put, refresh };
}

/**
 * Which frames are drawn live and which as pictures, for the part of the board in view: those in
 * view and near it, the biggest on screen and the picked one live, up to a number at once.
 */
function pickModes(lay: BoardLayout, view: Rect, z: number, selected: string | null, pics: boolean, noPic: Set<string>): Map<string, Mode> {
  const out = new Map<string, Mode>();
  const ox = view.w * 0.25, oy = view.h * 0.25;
  const near = (r: Rect, mx: number, my: number) => r.x < view.x + view.w + mx && r.x + r.w > view.x - mx && r.y < view.y + view.h + my && r.y + r.h > view.y - my;
  const seen: LaidFrame[] = [];
  for (const s of lay.sections) if (near(s, ox, oy)) for (const f of s.frames) if (near(f, ox, oy)) seen.push(f);
  const live = seen
    .filter((f) => f.id === selected || noPic.has(f.id) || !pics || f.w * z >= LIVE_MIN)
    .map((f) => ({ f, rank: (f.id === selected ? 4 : 0) + (near(f, 0, 0) ? 2 : 0), area: Math.min(f.w, view.w) * Math.min(f.h, view.h) }))
    .sort((a, b) => b.rank - a.rank || b.area - a.area)
    .slice(0, pics ? LIVE_MAX : LIVE_MAX_BARE);
  for (const { f } of live) out.set(f.id, "live");
  if (pics) for (const f of seen) if (!out.has(f.id) && !noPic.has(f.id)) out.set(f.id, "pic");
  return out;
}

export function DesignBoard({ projectId, initial, swatch }: { projectId: string; initial: DesignMeta; swatch: Swatch }) {
  const toast = useToast();
  const { design, put } = useSheet(initial);
  const { data: project } = useLive(() => api.projects.get(projectId), [projectId]);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [viewW, setViewW] = useState(0);
  const [viewH, setViewH] = useState(0);
  const [hand, setHand] = useState(false);
  // How tall frames were drawn here: live, or as pictures. Each is kept under the frame as drawn.
  const [heights, setHeights] = useState<Record<string, { rev: string; h: number }>>({});
  // What is written in the inspector and not saved yet, by frame: a frame's draft stays its own
  // when another frame is picked, and is there again on going back to it.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [preview, setPreview] = useState<{ id: string; draft: Draft } | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "error">("idle");
  const [asking, setAsking] = useState<Asking | null>(null);
  // Pictures of frames, while the studio can draw them; and frames whose picture would not come.
  const [pics, setPics] = useState(true);
  const [noPic, setNoPic] = useState<Set<string>>(() => new Set());
  const view = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // ── code, a frame at a time ──
  // The code here, for drawing; the ref holds the same for asking, outside drawing.
  const code = useRef(new Map<string, FrameCode>());
  const [codes, setCodes] = useState<ReadonlyMap<string, FrameCode>>(() => new Map());
  const asked = useRef(new Set<string>());
  const wanted = useRef(new Set<string>());
  const askTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const metaOf = useMemo(() => new Map(design.sections.flatMap((s) => s.frames.map((f) => [f.id, f] as const))), [design]);
  const codeOf = (id: string): FrameCode | undefined => { const c = codes.get(id); return c && c.code === metaOf.get(id)?.code ? c : undefined; };
  /** Ask for the code of these frames, when it is not here as they are now: a few at once, together. */
  const need = useCallback((ids: string[]) => {
    for (const id of ids) {
      const m = metaOf.get(id);
      if (!m || code.current.get(id)?.code === m.code || asked.current.has(`${id}:${m.code}`)) continue;
      wanted.current.add(id);
    }
    if (!wanted.current.size || askTimer.current) return;
    askTimer.current = setTimeout(async () => {
      askTimer.current = undefined;
      const ids = [...wanted.current];
      wanted.current.clear();
      const keys = ids.map((id) => `${id}:${metaOf.get(id)?.code}`);
      for (const k of keys) asked.current.add(k);
      try {
        const got = await api.designs.code(design.id, ids);
        for (const [id, c] of Object.entries(got)) code.current.set(id, c);
        setCodes(new Map(code.current));
      } catch { /* asked again when next wanted */ }
      // Asked once at a time, not once ever: Undo can bring back code that was here before.
      for (const k of keys) asked.current.delete(k);
    }, 20);
  }, [design.id, metaOf]);

  // The frames a model is designing or looking at, outlined; following it, the newest is brought into view.
  const marks = useMarks((w) => (w.designId === initial.id ? w.frameIds : null));
  const leadFrame = leadOf(marks);
  const where = design.sections.map((section) => ({ section, frame: section.frames.find((x) => x.id === selected) })).find((w): w is { section: SectionMeta; frame: FrameMeta } => !!w.frame) ?? null;
  const selectedCode = where ? codeOf(where.frame.id) : undefined;
  const full: DesignFrame | null = where && selectedCode ? { ...where.frame, html: selectedCode.html, css: selectedCode.css } : null;
  useEffect(() => { if (selected) need([selected]); }, [selected, need, design]);

  // Comments: pinned to a spot on a frame, or on the sheet as a whole. With the panel open, a
  // click on a frame places one; the pins of the open ones show on the board all the time.
  const commentsOn: CommentsOn = { kind: "design", projectId, designId: design.id, name: design.name };
  const { threads, refresh: refreshComments } = useComments(commentsOn);
  const cs = useCommentState();
  const [commenting, setCommenting] = useState(false);
  const pinsOf = useMemo(() => {
    const m = new Map<string, typeof threads>();
    for (const t of shownThreads(threads, cs)) if (t.frameId) m.set(t.frameId, [...(m.get(t.frameId) ?? []), t]);
    return m;
  }, [threads, cs]);
  const openComments = threads.filter((t) => !t.resolvedAt).length;
  const comment = (on: boolean) => {
    setCommenting(on);
    cs.setPicking(on);
    if (on) setSelected(null); else { cs.setDraft(null); cs.setActive(null); }
  };
  const pickComment = (id: string) => { setCommenting(true); setSelected(null); cs.setActive(id); };

  // ── the layout: where every section and frame is, in the frames' pixels ──
  // What is written in the inspector shows on the board a moment after the typing stops, at its size.
  const shownPreview = preview && selected === preview.id && drafts[preview.id] ? preview : null;
  const previewRev = shownPreview ? `p-${hashOf(shownPreview.draft.html + "\0" + shownPreview.draft.css)}-${shownPreview.draft.width}` : null;
  const sections = useMemo(() => !shownPreview ? design.sections : design.sections.map((s) => ({
    ...s, frames: s.frames.map((f) => (f.id === shownPreview.id ? { ...f, name: shownPreview.draft.name, width: shownPreview.draft.width, height: shownPreview.draft.height ?? undefined } : f)),
  })), [design, shownPreview]);
  const lay = useMemo(() => layoutDesign(sections, (f) => {
    const m = f as FrameMeta;
    const seen = heights[m.id];
    const rev = shownPreview?.id === m.id ? previewRev : frameRev(m);
    return seen && seen.rev === rev ? seen.h : (shownPreview?.id !== m.id && m.measured) || guessHeight(m);
  }), [sections, heights, shownPreview, previewRev]);
  const boxOf = useMemo(() => new Map(lay.sections.flatMap((s) => s.frames.map((f) => [f.id, f] as const))), [lay]);

  // The zoom that fits the board's width in the window, no bigger than the frames' own size.
  const fit = useMemo(() => (!viewW || !lay.w ? 0.25 : Math.max(ZOOM_MIN, Math.min(1, (viewW - 2 * EDGE) / lay.w))), [lay.w, viewW]);
  const z = zoom === "fit" ? fit : zoom;
  // The zoom as last asked for: ahead of what is drawn while a pinch runs faster than drawing.
  const zNow = useRef(z);
  // Room round the board, on screen: half the window, so any frame can be brought to its middle.
  const mx = Math.max(EDGE, Math.round(viewW / 2)), my = Math.max(EDGE, Math.round(viewH / 2));

  useEffect(() => {
    const ro = new ResizeObserver(() => { if (view.current) { setViewW(view.current.clientWidth); setViewH(view.current.clientHeight); } });
    if (view.current) ro.observe(view.current);
    return () => ro.disconnect();
  }, []);

  // ── where the view is on the board ──
  /** A point in the view, as a point on the board. */
  const toBoard = (sx: number, sy: number, at = { z: zNow.current, x: lay.x, y: lay.y }) => {
    const v = view.current!;
    return { bx: (v.scrollLeft + sx - mx) / at.z + at.x, by: (v.scrollTop + sy - my) / at.z + at.y };
  };
  /** Scroll so the board's point bx, by is at sx, sy in the view. */
  const bring = (bx: number, by: number, sx: number, sy: number) => {
    const v = view.current; if (!v) return;
    v.scrollLeft = (bx - lay.x) * zNow.current + mx - sx;
    v.scrollTop = (by - lay.y) * zNow.current + my - sy;
  };

  // A point on the board to keep where it is on screen while the zoom changes.
  const anchor = useRef<{ bx: number; by: number; sx: number; sy: number } | null>(null);
  // Where the board was last drawn from: when its corner moves (a section put above or left of
  // the rest, or the window resized), the view moves with it, so nothing on screen jumps.
  const drawn = useRef<{ x: number; y: number; z: number; mx: number; my: number } | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const v = view.current, w = wrap.current;
    if (!v || !w || !viewW) return;
    zNow.current = z;
    w.style.width = `${lay.w * z + 2 * mx}px`;
    w.style.height = `${lay.h * z + 2 * my}px`;
    const was = drawn.current;
    const a = anchor.current;
    anchor.current = null;
    if (a) bring(a.bx, a.by, a.sx, a.sy);
    else if (!was) { v.scrollLeft = mx - EDGE; v.scrollTop = my - EDGE_TOP; }
    else {
      // The board moved under the view (its corner, the window's size, or the fit with it): what
      // was at the view's top left stays there; at the fit, the board's left edge stays at its edge.
      const bx = (v.scrollLeft - was.mx) / was.z + was.x, by = (v.scrollTop - was.my) / was.z + was.y;
      v.scrollLeft = zoom === "fit" && was.z !== z ? mx - EDGE : (bx - lay.x) * z + mx;
      v.scrollTop = (by - lay.y) * z + my;
    }
    drawn.current = { x: lay.x, y: lay.y, z, mx, my };
    // Shown once placed: the first scroll is set before the board is seen, so it does not jump.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!ready) setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [z, lay.x, lay.y, lay.w, lay.h, mx, my, viewW]);

  /** Zoom to `to`, keeping the point at x, y in the view (its middle, unless given) where it is. */
  const zoomTo = (to: number | "fit", x?: number, y?: number, keep?: { bx: number; by: number; sx: number; sy: number }) => {
    const v = view.current; if (!v) return;
    const next = to === "fit" ? fit : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, to));
    const sx = x ?? v.clientWidth / 2, sy = y ?? v.clientHeight / 2;
    // To fit is to fit the board's width: its middle comes to the middle of the view.
    const a = keep ?? (to === "fit" ? { bx: lay.x + lay.w / 2, by: toBoard(sx, sy).by, sx: v.clientWidth / 2, sy } : { ...toBoard(sx, sy), sx, sy });
    setZoom(to === "fit" ? "fit" : next);
    if (Math.abs(next - zNow.current) < 1e-6) { zNow.current = next; bring(a.bx, a.by, a.sx, a.sy); return; }
    zNow.current = next;
    anchor.current = a;
  };
  const step = (dir: 1 | -1) => zoomTo(stepZoom(z, dir, ZOOM_MIN, ZOOM_MAX));
  /** A frame, whole and in the middle of the view, as big as the view holds it. */
  const zoomToFrame = (id: string) => {
    const v = view.current, f = boxOf.get(id);
    if (!v || !f) return;
    const want = Math.min((v.clientWidth - 2 * FRAME_ROOM) / f.w, (v.clientHeight - 2 * FRAME_ROOM - 24) / f.h);
    zoomTo(want, undefined, undefined, { bx: f.x + f.w / 2, by: f.y + f.h / 2, sx: v.clientWidth / 2, sy: v.clientHeight / 2 + 12 });
  };

  // Ctrl or Cmd with the wheel, or a pinch, zooms about the pointer. Without, the board scrolls.
  const zoomAtRef = useRef(zoomTo);
  useEffect(() => {
    const v = view.current; if (!v) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = v.getBoundingClientRect();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? v.clientHeight : 1);
      zoomAtRef.current(wheelZoom(zNow.current, dy, ZOOM_MIN, ZOOM_MAX), e.clientX - r.left, e.clientY - r.top);
    };
    v.addEventListener("wheel", onWheel, { passive: false });
    return () => v.removeEventListener("wheel", onWheel);
  }, []);

  // ── what is seen: drawn live, as pictures, or as outlines ──
  const [seen, setSeen] = useState<Rect | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const look = useCallback(() => {
    const v = view.current, d = drawn.current;
    if (!v || !d) return;
    const r = { x: (v.scrollLeft - d.mx) / d.z + d.x, y: (v.scrollTop - d.my) / d.z + d.y, w: v.clientWidth / d.z, h: v.clientHeight / d.z };
    setSeen((o) => (o && Math.abs(o.x - r.x) < 1 && Math.abs(o.y - r.y) < 1 && Math.abs(o.w - r.w) < 1 && Math.abs(o.h - r.h) < 1 ? o : r));
  }, []);
  // Looked at a few times a second while the board moves, not at every step of a scroll or a pinch.
  const lookSoon = useCallback(() => { if (!settle.current) settle.current = setTimeout(() => { settle.current = undefined; look(); }, 100); }, [look]);
  useEffect(() => { if (ready) lookSoon(); }, [ready, z, lay, viewW, viewH, lookSoon]);
  useEffect(() => () => clearTimeout(settle.current), []);
  const modes = useMemo(() => (seen ? pickModes(lay, seen, z, selected, pics, noPic) : new Map<string, Mode>()), [seen, lay, z, selected, pics, noPic]);
  useEffect(() => { need([...modes].filter(([, m]) => m === "live").map(([id]) => id)); }, [modes, need]);

  // ── heights: measured here, and kept for the next time ──
  const toKeep = useRef<Record<string, { rev: string; height: number }>>({});
  const keepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onHeight = useCallback((id: string, rev: string, h: number, keep: boolean) => {
    setHeights((m) => (m[id]?.rev === rev && m[id].h === h ? m : { ...m, [id]: { rev, h } }));
    const f = metaOf.get(id);
    // Kept for next time only as measured from the page itself, and only when it is news.
    if (!keep || !f || f.height || rev !== frameRev(f) || f.measured === h) return;
    toKeep.current[id] = { rev, height: h };
    clearTimeout(keepTimer.current);
    keepTimer.current = setTimeout(() => { const sizes = toKeep.current; toKeep.current = {}; void api.designs.sizes(design.id, sizes).catch(() => {}); }, 1500);
  }, [metaOf, design.id]);
  // Frames never measured are measured by the studio all at once, so the board is laid out right
  // before they are seen; a frame's picture or live page measures it too.
  const measuring = useRef(false);
  const [canMeasure, setCanMeasure] = useState(true);
  useEffect(() => {
    if (!canMeasure || measuring.current) return;
    const missing = design.sections.some((s) => s.frames.some((f) => !f.height && f.measured == null && heights[f.id]?.rev !== frameRev(f)));
    if (!missing) return;
    measuring.current = true;
    api.designs.measure(design.id)
      .then((got) => setHeights((m) => ({ ...m, ...Object.fromEntries(Object.entries(got).map(([id, v]) => [id, { rev: v.rev, h: v.height }])) })))
      .catch((e) => { setCanMeasure(false); if (e instanceof ApiError && e.kind === "renderer_unavailable") setPics(false); })
      .finally(() => { measuring.current = false; });
  }, [design, heights, canMeasure]);
  const swatchKey = useMemo(() => brandKey(swatch), [swatch]);
  const picFailed = useCallback((id: string, url: string) => {
    setNoPic((s) => (s.has(id) ? s : new Set([...s, id])));
    // Asked why: no browser to draw with means no pictures at all, and more frames live instead.
    void fetch(url).then((r) => { if (r.status === 503) setPics(false); }).catch(() => {});
  }, []);

  // ── moving about: a drag on the space between frames, the middle button, or Space or the hand ──
  const space = useSpaceHeld();
  const handy = hand || space;
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  // The click a drag ends with is not a click: it neither selects nor lets go.
  const quiet = useRef(false);
  const panFrom = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop, moved: false };
  };
  const panDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    if (e.button === 1 || (e.button === 0 && handy)) { e.stopPropagation(); panFrom(e); }
  };
  const panDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch" || e.button !== 0 || (e.target as HTMLElement).closest(NOT_EMPTY)) return;
    panFrom(e);
  };
  const panMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    if (!d.moved) { d.moved = true; setDragging(true); }
    e.currentTarget.scrollLeft = d.left - dx;
    e.currentTarget.scrollTop = d.top - dy;
  };
  const panUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (d.moved) { quiet.current = true; setTimeout(() => { quiet.current = false; }, 0); }
  };

  // The zoom keys, wherever the board has the keys: not while typing in the inspector or a dialog.
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const onKeys = (e: KeyboardEvent) => {
    if (e.defaultPrevented || typingIn(e.target)) return;
    const k = zoomKey(e); if (!k) return;
    if (k === "selection" && !selected) return;
    e.preventDefault();
    if (k === "in") step(1);
    else if (k === "out") step(-1);
    else if (k === "fit") zoomTo("fit");
    else if (k === "actual") zoomTo(1);
    else if (k === "selection" && selected) zoomToFrame(selected);
    else if (k === "hand") setHand((h) => !h);
  };
  // The listeners hold refs, given the newest of the board's own handlers after each drawing.
  useLayoutEffect(() => { zoomAtRef.current = zoomTo; keysRef.current = onKeys; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The inspector starts from the frame as it is, and follows it while nothing is changed there.
  const base = full ? draftOf(full) : null;
  const written = where ? drafts[where.frame.id] : undefined;
  const draft = written ?? base;
  const dirty = !!(written && base && !same(written, base));
  const forget = (id: string) => setDrafts(({ [id]: _, ...rest }) => rest);
  const setDraft = (d: Draft) => {
    if (!where || !base) return;
    const id = where.frame.id;
    if (same(d, base)) forget(id); else setDrafts((m) => ({ ...m, [id]: d }));
  };
  useEffect(() => {
    if (!dirty || !selected || !written) return;
    const t = setTimeout(() => setPreview({ id: selected, draft: written }), 400);
    return () => clearTimeout(t);
  }, [written, dirty, selected]);

  const change = useCallback(async (ops: DesignOp[], said?: string) => {
    setSaving("saving");
    try {
      const r = await api.designs.change(design.id, ops);
      put(r);
      setSaving("idle");
      if (said) toast(said, { label: "Undo", onClick: () => void api.designs.undo(design.id).then(put) });
      return r;
    } catch (e) { setSaving("error"); toast.problem((e as Error).message); return null; }
  }, [design.id, put, toast]);

  const undo = async () => { try { put(await api.designs.undo(design.id)); } catch (e) { toast.problem((e as Error).message); } };
  const save = async () => {
    if (!where || !draft) return;
    const r = await change([{ op: "setFrame", section: where.section.id, frameId: where.frame.id, name: draft.name, width: draft.width, height: draft.height, note: draft.note, html: draft.html, css: draft.css }]);
    if (r) { forget(where.frame.id); setPreview(null); }
  };

  // A frame's handlers, the same from one drawing to the next, so a frame that has not changed is not drawn again.
  const act = useRef({ select: (_: string) => {}, zoom: (_: string) => {}, height: onHeight, comment: (_: string, __: number, ___: number) => {}, picFailed });
  useLayoutEffect(() => {
    act.current.select = (id) => { setSelected(id); if (commenting) comment(false); };
    act.current.zoom = zoomToFrame;
    act.current.height = onHeight;
    act.current.picFailed = picFailed;
    act.current.comment = (id, x, y) => { const f = metaOf.get(id); cs.setDraft({ x, y, frameId: id, frameName: f?.name ?? "" }); cs.setActive(null); };
  });

  const projectName = project?.name ?? "Project";
  const home = `/projects/${projectId}`;
  const sectionMenu = (s: SectionMeta, i: number) => [
    { label: "Rename", icon: <Pencil size={14} />, onSelect: () => setAsking({ kind: "section", section: s }) },
    { label: "Move up", icon: <ArrowUp size={14} />, disabled: i === 0, onSelect: () => void change([{ op: "moveSection", section: s.id, to: i - 1 }]) },
    { label: "Move down", icon: <ArrowDown size={14} />, disabled: i === design.sections.length - 1, onSelect: () => void change([{ op: "moveSection", section: s.id, to: i + 1 }]) },
    { label: "Download as a picture", icon: <Download size={14} />, disabled: !s.frames.length, onSelect: () => { window.location.href = api.designs.pictureUrl(design.id, { section: s.id }); } },
    { label: "Download its code", icon: <FileCode size={14} />, disabled: !s.frames.length, onSelect: () => { window.location.href = api.designs.codeUrl(design.id, { section: s.id }); } },
    { label: "Download everything, with a style guide", icon: <Package size={14} />, disabled: !s.frames.length, onSelect: () => { toast(`Putting ${s.name} together. It takes a moment to draw.`); window.location.href = api.designs.bundleUrl(design.id, { section: s.id }); } },
    { label: "Delete the section", icon: <Trash2 size={14} />, danger: true, onSelect: () => (s.frames.length ? setAsking({ kind: "delete-section", section: s }) : void change([{ op: "removeSection", section: s.id }], `Deleted ${s.name}`)) },
  ];
  const catching = commenting && cs.picking && !cs.draft;

  return (
    <div className="design-page">
      <header className="editor-bar" style={{ height: "var(--topbar-h)", borderBottom: "1px solid var(--line)", background: "var(--surface)", display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "0 var(--space-3)", flexShrink: 0 }}>
        <Tip text={`Back to the designs in ${projectName}`}><Link href={`${home}/designs`} className="icon-btn" aria-label={`Back to the designs in ${projectName}`}><ArrowLeft size={16} /></Link></Tip>
        <div className="editor-title">
          <nav aria-label="Breadcrumbs" className="editor-where body-sm">
            <Link href="/" className="editor-where-link">Projects</Link><ChevronRight size={12} aria-hidden />
            <Link href={home} className="editor-where-link" title={projectName}>{projectName}</Link><ChevronRight size={12} aria-hidden />
            <Link href={`${home}/designs`} className="editor-where-link">Designs</Link>
          </nav>
          <div className="editor-name">
            <input aria-label="Design name" aria-current="page" defaultValue={design.name} key={design.name} title={design.name} className="label editor-name-input" style={{ width: Math.max(8, design.name.length + 1) + "ch" }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== design.name) void change([{ op: "rename", name: v }]); else e.target.value = design.name; }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
            <span role="status" aria-live="polite" className="editor-saved" data-state={saving}>{saving === "saving" ? "Saving..." : saving === "error" ? "Not saved" : "Saved"}</span>
          </div>
        </div>
        <span className="editor-presence"><ModelPresence variant="bar" /></span>
        <div style={{ flex: 1 }} />
        <div className="editor-group roomy">
          <Button size="sm" tip="A labelled part of the board, like Foundations, Components or Pages." onClick={() => setAsking({ kind: "section" })}><Plus size={14} aria-hidden /> Add a section</Button>
        </div>
        <div className="editor-group">
          <IconButton label="Undo" hint="Takes back the last change to the sheet, yours or your model's." disabled={!design.canUndo} onClick={undo}><Undo2 size={16} /></IconButton>
        </div>
        <div className="editor-group">
          <ZoomControls zoom={zoom} scale={z} onZoom={(v) => zoomTo(v)} onStep={step} hand={hand} onHand={setHand}
            onSelection={selected ? () => zoomToFrame(selected) : undefined} selectionHint="Zoom to selection (select a frame first)" />
        </div>
        <div className="editor-group">
          <Button size="sm" aria-pressed={commenting} tip="Pin a comment to the spot on a frame that should change. Your model can read each one and do what it says." onClick={() => comment(!commenting)}>
            <MessageSquare size={14} aria-hidden /> Comments{openComments > 0 && <span className="tab-count" aria-label={`, ${openComments} open`}>{openComments}</span>}
          </Button>
        </div>
        <div className="editor-group roomy">
          <AskModelButton size="sm" about={aboutDesign(projectId, design)} />
          <Menu trigger={<Button size="sm"><Download size={14} aria-hidden /> Download</Button>} items={[
            { label: "The sheet, as a picture", onSelect: () => { window.location.href = api.designs.pictureUrl(design.id); } },
            { label: "The code: a page for each frame", onSelect: () => { window.location.href = api.designs.codeUrl(design.id); } },
            { label: "Everything: pictures, code, fonts, images and a style guide", onSelect: () => { toast("Putting it together. A big sheet takes a moment to draw."); window.location.href = api.designs.bundleUrl(design.id); } },
          ]} />
        </div>
      </header>

      <div className="design-body">
        <div className="design-view" ref={view} data-hand={handy || undefined} data-dragging={dragging || undefined}
          onScroll={lookSoon}
          onPointerDownCapture={panDownCapture} onPointerDown={panDown} onPointerMove={panMove} onPointerUp={panUp} onPointerCancel={panUp}
          onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
          onClickCapture={(e) => { if (quiet.current) { quiet.current = false; e.stopPropagation(); e.preventDefault(); } }}
          onClick={(e) => { if (!handy && !(e.target as HTMLElement).closest(".design-frame, button, a, [role=menu]")) setSelected(null); }}
          onDoubleClick={(e) => { if (!handy && !(e.target as HTMLElement).closest(NOT_EMPTY)) zoomTo("fit"); }}>
          <div ref={wrap} className="design-wrap" style={{ visibility: ready ? undefined : "hidden" }}>
            <div className="design-board" data-small={z < LABELS_MIN || undefined} style={{ left: mx, top: my, width: lay.w, height: lay.h, transform: `scale(${z})`, "--z": z, "--hz": Math.max(z, HEAD_Z), "--az": Math.max(z, ADD_Z) } as CSSProperties}>
              {design.sections.map((s, i) => {
                const b = lay.sections[i];
                return (
                  <section key={s.id} className="design-section" aria-labelledby={`sec-${s.id}`} style={{ left: b.x - lay.x, top: b.y - lay.y, width: b.w, height: b.h }}>
                    <header>
                      <h2 id={`sec-${s.id}`}>{s.name}</h2>
                      {s.note && <p title={s.note}>{s.note}</p>}
                      <IconButton label={`Add a frame to ${s.name}`} onClick={() => setAsking({ kind: "frame", section: s })}><Plus size={14} /></IconButton>
                      <Menu trigger={<IconButton label={`Actions for ${s.name}`}><MoreHorizontal size={14} /></IconButton>} items={sectionMenu(s, i)} />
                    </header>
                    {s.frames.map((m) => {
                      const box = boxOf.get(m.id)!;
                      const p = shownPreview?.id === m.id ? shownPreview.draft : null;
                      const mode = modes.get(m.id);
                      // Live: the draft, or the code as it is; the code it had until that comes, so a change does not flash.
                      const c = mode === "live" ? (p ? { code: "", html: p.html, css: p.css } : codes.get(m.id)) : undefined;
                      const f = p ? { ...m, name: p.name, width: p.width, height: p.height ?? undefined } : m;
                      const pins = pinsOf.get(m.id) ?? [];
                      return <FrameView key={m.id} f={f} x={box.x - b.x} y={box.y - b.y} h={box.h}
                        rev={p ? previewRev! : frameRev(c ? { ...m, code: c.code } : m)} doc={c ? frameDoc({ ...f, html: c.html, css: c.css }, swatch, projectId) : null}
                        pic={mode === "pic" || (mode === "live" && !c && pics && !noPic.has(m.id)) ? framePicUrl(design.id, m, swatchKey) : null}
                        selected={selected === m.id} mark={marks.get(m.id)} lead={leadFrame === m.id} act={act}
                        pins={(pins.length > 0 || cs.draft?.frameId === m.id) ? <Pins threads={pins} draft={cs.draft?.frameId === m.id ? cs.draft : null} active={cs.active} onPick={(t) => pickComment(t.id)} /> : null}
                        catching={catching} />;
                    })}
                    {!s.frames.length && <button type="button" className="design-add" style={{ left: BOARD.pad, top: BOARD.pad }} onClick={() => setAsking({ kind: "frame", section: s })}><Plus aria-hidden /> Add a frame</button>}
                  </section>
                );
              })}
            </div>
          </div>
        </div>

        {commenting && (
          <aside className="design-inspector" aria-label="Comments on the sheet">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <h2 className="label" style={{ margin: 0, flex: 1 }}>Comments on {design.name}</h2>
              <IconButton label="Close the comments" onClick={() => comment(false)}><X size={16} /></IconButton>
            </div>
            <CommentThreads on={commentsOn} threads={threads} c={cs} refresh={refreshComments} wholeWords="sheet" hint="Click the spot on a frame that should change." heading={false}
              onGo={(t) => { if (t.frameId && metaOf.has(t.frameId)) zoomToFrame(t.frameId); }} />
          </aside>
        )}
        {!commenting && where && (draft && full ? (
          <Inspector key={where.frame.id} design={design} projectId={projectId} section={where.section} frame={full} draft={draft} setDraft={setDraft} dirty={dirty}
            onSave={save} onDiscard={() => { forget(where.frame.id); setPreview(null); }} onClose={() => setSelected(null)}
            change={change} onSelect={setSelected} />
        ) : (
          <aside className="design-inspector" aria-label={`Frame: ${where.frame.name}`} aria-busy>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <h2 className="label" style={{ margin: 0, flex: 1 }}>{where.frame.name}</h2>
              <IconButton label="Close" onClick={() => setSelected(null)}><X size={16} /></IconButton>
            </div>
            <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Loading its code...</p>
          </aside>
        ))}
      </div>

      <ModelAtWork right={where || commenting ? 436 : 16} />
      <SectionDialog asking={asking?.kind === "section" ? asking : null} onClose={() => setAsking(null)}
        onDone={async (name, note, s) => { await change(s ? [{ op: "updateSection", section: s.id, name, note }] : [{ op: "addSection", name, note }]); }} />
      <FrameDialog asking={asking?.kind === "frame" ? asking : null} onClose={() => setAsking(null)}
        onDone={async (s, name, width) => {
          const r = await change([{ op: "setFrame", section: s.id, name, width, ...newFrameCode(name, width) }]);
          if (r?.made.frames[0]) setSelected(r.made.frames[0]);
        }} />
      <ConfirmDialog open={asking?.kind === "delete-section"} onOpenChange={(o) => !o && setAsking(null)} title={`Delete ${asking?.kind === "delete-section" ? asking.section.name : "the section"}?`}
        description={asking?.kind === "delete-section" ? `Its ${asking.section.frames.length} frame${asking.section.frames.length === 1 ? "" : "s"} go with it. Undo brings them back.` : undefined} confirmLabel="Delete the section"
        onConfirm={async () => { if (asking?.kind === "delete-section") await change([{ op: "removeSection", section: asking.section.id }], `Deleted ${asking.section.name}`); setAsking(null); }} />
    </div>
  );
}

type Act = { select: (id: string) => void; zoom: (id: string) => void; height: (id: string, rev: string, h: number, keep: boolean) => void; comment: (id: string, x: number, y: number) => void; picFailed: (id: string, url: string) => void };

/**
 * One frame on the board: its label, the frame drawn live (`doc`), as a picture (`pic`) or as its
 * outline, and the button that selects it. Drawn again only when something it shows changes.
 */
const FrameView = memo(function FrameView({ f, x, y, h, rev, doc, pic, selected, mark, lead, act, pins, catching }: {
  f: Pick<FrameMeta, "id" | "name" | "width" | "height" | "by">; x: number; y: number; h: number; rev: string; doc: string | null; pic: string | null;
  selected: boolean; mark?: Mark; lead: boolean; act: { current: Act };
  /** The comments pinned to it. */
  pins?: ReactNode;
  /** While a comment is placed, a click on the frame places it. */
  catching: boolean;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const measure = async () => { if (!f.height && ref.current) { const m = await frameHeight(ref.current); if (m) act.current.height(f.id, rev, m, true); } };
  // A frame can finish loading before its onLoad is listened for: measured now if its page is already in.
  useEffect(() => {
    const d = ref.current?.contentDocument;
    if (d?.URL === "about:srcdoc" && d.readyState === "complete") void measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);
  return (
    <figure className="design-frame" style={{ left: x, top: y, width: f.width }}>
      <figcaption title={`${f.name}, ${frameSize(f)}${f.by === "model" ? ", by your model" : ""}`}>{f.name}<span>{frameSize(f)}</span>{f.by === "model" && <span>by your model</span>}</figcaption>
      <div className="design-frame-box" data-frame-box={f.id} data-drawn={doc ? "live" : pic ? "picture" : "outline"} style={{ width: f.width, height: h }}>
        {/* Drawn and nothing more: no scripts run in it, and nothing in it can be focused or clicked. */}
        {doc ? <iframe ref={ref} title={f.name} inert sandbox="allow-same-origin" srcDoc={doc} style={{ width: f.width, height: h }} onLoad={() => void measure()} />
          : pic ? <img className="design-pic" src={pic} alt="" decoding="async" draggable={false}
            onLoad={(e) => { const i = e.currentTarget; if (!f.height && i.naturalWidth) act.current.height(f.id, rev, Math.round(i.naturalHeight * f.width / i.naturalWidth), false); }}
            onError={() => act.current.picFailed(f.id, pic)} /> : null}
        {/* data-pan-ok: with a frame focused, Space still drags the board about. */}
        <button type="button" className="design-frame-hit" data-pan-ok aria-label={`${f.name}, ${frameSize(f)}`} aria-pressed={selected} onClick={() => act.current.select(f.id)} onDoubleClick={() => act.current.zoom(f.id)} />
        <ModelMark mark={mark} lead={lead} />
        {pins}
        {catching && <PinCatch label={`Place a comment on ${f.name}`} onSpot={(px, py) => act.current.comment(f.id, px, py)} />}
      </div>
    </figure>
  );
});

function Inspector({ design, projectId, section, frame, draft, setDraft, dirty, onSave, onDiscard, onClose, change, onSelect }: {
  design: DesignMeta; projectId: string; section: SectionMeta; frame: DesignFrame; draft: Draft; setDraft: (d: Draft) => void; dirty: boolean;
  onSave: () => void; onDiscard: () => void; onClose: () => void; change: (ops: DesignOp[], said?: string) => Promise<{ made: { frames: string[] } } | null>; onSelect: (id: string | null) => void;
}) {
  const lint = useMemo(() => lintDesignCode(draft.html, draft.css), [draft.html, draft.css]);
  const errors = lint.filter((l) => l.level === "error");
  const device = deviceOf(draft.width) ?? "custom";
  const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const changedByModel = dirty && frame.by === "model";
  return (
    <aside className="design-inspector" aria-label={`Frame: ${frame.name}`} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); if (dirty && !errors.length) onSave(); } }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <h2 className="label" style={{ margin: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{frame.name}</h2>
        <IconButton label="Close" onClick={onClose}><X size={16} /></IconButton>
      </div>
      <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>In {section.name}{frame.by === "model" ? ", last changed by your model" : ""}. Colours, fonts and corners are the Swatch&apos;s, as CSS variables like var(--color-primary). A picture from Yarn is yarn:&lt;its id&gt;.</p>
      <Field label="Name" htmlFor="frame-name"><Input id="frame-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} /></Field>
      <div className="field">
        <span className="field-label" aria-hidden>Width</span>
        <SegmentedControl<DesignDevice | "custom"> label="Width" value={device} options={DEVICE_OPTIONS} onChange={(v) => { if (v !== "custom") set({ width: DESIGN_DEVICES[v].width }); else if (device !== "custom") set({ width: draft.width + 1 }); }} />
        {device === "custom" && <Input aria-label="Width in pixels" type="number" min={240} max={3840} value={draft.width} onChange={(e) => set({ width: Number(e.target.value) || draft.width })} style={{ width: 120 }} />}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "var(--space-2)", alignItems: "end" }}>
        <Field label="Height" htmlFor="frame-height">
          <Select id="frame-height" value={draft.height ? "fixed" : "auto"} onValueChange={(v) => set({ height: v === "fixed" ? (DESIGN_DEVICES[deviceOf(draft.width) ?? "desktop"].height) : null })}
            options={[{ value: "auto", label: "As tall as what is in it" }, { value: "fixed", label: "One screen, fixed" }]} />
        </Field>
        {draft.height != null && <Input aria-label="Height in pixels" type="number" min={160} max={20000} value={draft.height} onChange={(e) => set({ height: Number(e.target.value) || draft.height })} style={{ width: 100 }} />}
      </div>
      <Field label="Note" htmlFor="frame-note" hint="What it is for, or what to do next. Your model reads it."><Textarea id="frame-note" rows={2} value={draft.note} onChange={(e) => set({ note: e.target.value })} /></Field>
      <Field label="HTML" htmlFor="frame-html"><Textarea id="frame-html" className="code" rows={14} spellCheck={false} value={draft.html} onChange={(e) => set({ html: e.target.value })} /></Field>
      <Field label="CSS" htmlFor="frame-css"><Textarea id="frame-css" className="code" rows={10} spellCheck={false} value={draft.css} onChange={(e) => set({ css: e.target.value })} /></Field>
      {lint.length > 0 && <ul aria-label="Problems" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
        {lint.map((l) => <li key={l.message} className={l.level === "error" ? "field-error" : "body-sm"} style={l.level === "error" ? undefined : { color: "var(--ink-muted)" }}>{l.level === "error" && <AlertTriangle size={13} aria-hidden />} {l.message}</li>)}
      </ul>}
      {changedByModel && <p role="status" className="body-sm" style={{ margin: 0 }}>Your model changed this frame while you were. Saving puts yours over it; Discard shows its version.</p>}
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <Button variant="primary" disabled={!dirty || !!errors.length} onClick={onSave} tip="Or press Ctrl+S.">Save</Button>
        <Button variant="ghost" disabled={!dirty} onClick={onDiscard}>Discard</Button>
      </div>
      <div style={{ display: "grid", gap: "var(--space-2)", borderTop: "1px solid var(--line)", paddingTop: "var(--space-4)" }}>
        <AskModelButton size="sm" about={aboutDesign(projectId, design, frame)} />
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <Button size="sm" onClick={async () => { const r = await change([{ op: "duplicateFrame", frameId: frame.id }], `Copied ${frame.name}`); if (r?.made.frames[0]) onSelect(r.made.frames[0]); }}><Copy size={14} aria-hidden /> Make a copy</Button>
          <a className="btn btn-sm" href={api.designs.pictureUrl(design.id, { frame: frame.id, scale: 2 })}><Download size={14} aria-hidden /> Picture</a>
          <Button size="sm" variant="ghost" onClick={async () => { onSelect(null); await change([{ op: "removeFrame", frameId: frame.id }], `Deleted ${frame.name}`); }}><Trash2 size={14} aria-hidden /> Delete</Button>
        </div>
        {design.sections.length > 1 && (
          <Field label="Section" htmlFor="frame-section">
            <Select id="frame-section" value={section.id} onValueChange={(v) => void change([{ op: "moveFrame", frameId: frame.id, section: v }])} options={design.sections.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
        )}
      </div>
    </aside>
  );
}

function SectionDialog({ asking, onClose, onDone }: { asking: { section?: SectionMeta } | null; onClose: () => void; onDone: (name: string, note: string, s?: SectionMeta) => Promise<void> }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const open = !!asking;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (asking) { setName(asking.section?.name ?? ""); setNote(asking.section?.note ?? ""); }
  }, [asking]);
  const done = async () => { if (!name.trim()) return; await onDone(name.trim(), note.trim(), asking?.section); onClose(); };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={asking?.section ? `Rename ${asking.section.name}` : "Add a section"} description="A labelled part of the board: Foundations, Components, Pages, or one for each part of the site."
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={done}>{asking?.section ? "Save" : "Add it"}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void done(); }} style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label="Name" htmlFor="section-name"><Input id="section-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Pages" /></Field>
        <Field label="Note" htmlFor="section-note" hint="Shown beside its name. Optional."><Input id="section-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </form>
    </Dialog>
  );
}

function FrameDialog({ asking, onClose, onDone }: { asking: { section: SectionMeta } | null; onClose: () => void; onDone: (s: SectionMeta, name: string, width: number) => Promise<void> }) {
  const [name, setName] = useState("");
  const [device, setDevice] = useState<DesignDevice>("desktop");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (asking) { setName(""); setDevice("desktop"); }
  }, [asking]);
  const done = async () => { if (!asking || !name.trim()) return; await onDone(asking.section, name.trim(), DESIGN_DEVICES[device].width); onClose(); };
  return (
    <Dialog open={!!asking} onOpenChange={(o) => !o && onClose()} title={`Add a frame to ${asking?.section.name ?? "the section"}`} description="A screen, or a piece of one. It starts with a heading in your brand, to write over or ask your model to design."
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={done}>Add it</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void done(); }} style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label="Name" htmlFor="frame-new-name"><Input id="frame-new-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Pricing" /></Field>
        <div className="field"><span className="field-label" aria-hidden>For</span>
          <SegmentedControl<DesignDevice> label="For" value={device} onChange={setDevice} options={(Object.keys(DESIGN_DEVICES) as DesignDevice[]).map((d) => ({ value: d, label: `${DESIGN_DEVICES[d].name} ${DESIGN_DEVICES[d].width}` }))} />
        </div>
      </form>
    </Dialog>
  );
}
