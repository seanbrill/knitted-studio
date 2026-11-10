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
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, ApiError, subscribeChanges, yarnFileUrl, yarnPictureUrl, yarnThumbUrl } from "@knitted/core/client";
import { DESIGN_DEVICES, BOARD, PIECE_NAMES, deviceOf, dropIndex, frameRev, frameSize, guessHeight, layoutDesign, lintDesignCode, snapToGrid, stillMs, type BoardLayout, type DesignDevice, type DesignFrame, type DesignMeta, type DesignOp, type FrameCode, type FrameMeta, type LaidFrame, type LaidSection, type Part, type Pattern, type PieceKind, type PieceNow, type SectionMeta, type Swatch, type Yarn } from "@knitted/core";
import { pageFor } from "@knitted/render/pure";
import { Button, ConfirmDialog, Dialog, Field, IconButton, Input, Menu, SegmentedControl, Select, TabPanel, Tabs, Textarea, Tip, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { brandKey, frameDoc, frameHeight, framePicUrl, hashOf } from "@/lib/design";
import { AskModelButton, AskModelDialog, aboutDesign, aboutPart, aboutPattern, aboutYarn, type About } from "./AskModel";
import { PatternThumb, thumbContext, type ThumbContext } from "./PatternThumb";
import { PartThumb } from "./editor/PartThumb";
import { KnitDialog } from "./editor/KnitDialog";
import { ModelPresence } from "./ModelPresence";
import { ModelAtWork } from "./ModelAtWork";
import { ModelMark } from "./ModelMark";
import { leadOf, useMarks, type Mark } from "@/lib/agent";
import { ZoomControls } from "./ZoomControls";
import { CommentThreads, PinCatch, Pins, shownThreads, useCommentState, useComments, type CommentsOn } from "./Comments";
import type { CommentThread } from "@knitted/core";
import { stepZoom, typingIn, useSpaceHeld, wheelZoom, zoomKey } from "@/lib/zoom";

const { ArrowLeft, ArrowUp, ArrowDown, ChevronRight, Copy, Download, ExternalLink, FileCode, Image, Layers, LayoutGrid, Maximize2, MessageSquare, MoreHorizontal, Package, Pencil, Plus, Shapes, Sparkles, Trash2, Undo2, X, AlertTriangle } = icons;
const ZOOM_MIN = 0.02;
const ZOOM_MAX = 4;
// Round a frame zoomed to: room to see it is the whole frame, and its label.
const FRAME_ROOM = 48;
// Round the board at its fit: room on screen beside it, and above it for the section names.
const EDGE = 40;
const EDGE_TOP = 64;
// Somewhere on the board that is not a frame or a control: a drag there moves the board.
const NOT_EMPTY = ".design-frame-box, .design-acts, button, a, input, textarea, select, [role=menu]";
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
/** The grid's dots are at least this far apart on screen: closer than that at 40 board pixels, every fifth shows, and so on. */
const DOTS_MIN = 14;
/** A zoom from a button or a key glides there in this long; a pinch is settled this long after it stops. */
const GLIDE_MS = 220;
const SETTLE_MS = 120;
/** The map's most room, in pixels. */
const MAP_W = 180;
const MAP_H = 128;
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const clampZ = (v: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
/** How far apart the grid's dots are on screen at zoom z, and where the board's 0, 0 is on the page round it. */
const dotsAt = (z: number, x: number, y: number, mx: number, my: number) => {
  let step = BOARD.grid * z;
  while (step < DOTS_MIN) step *= 5;
  return { "--dot": `${step}px`, "--dx": `${mx - x * z}px`, "--dy": `${my - y * z}px` };
};

/** Follow a press from where it went down until it lets go, anywhere in the window. A press that has not moved 4 pixels has not moved. */
function follow(e: React.PointerEvent, onMove: (ev: PointerEvent) => void, onUp: (moved: boolean) => void) {
  const id = e.pointerId, x0 = e.clientX, y0 = e.clientY;
  let moved = false;
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id || (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4)) return;
    moved = true;
    onMove(ev);
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
    onUp(moved);
  };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
}

/** Where a frame dropped at index `at` of a section goes, as a bar: before the frame at `at`, or after the one before it, whichever row the pointer (`py`) is nearer. */
function dropBar(sec: LaidSection, id: string, at: number, py: number): Rect {
  const others = sec.frames.filter((f) => f.id !== id);
  if (!others.length) return { x: sec.x + BOARD.pad / 2, y: sec.y + BOARD.pad, w: 0, h: Math.max(160, sec.h - 2 * BOARD.pad) };
  const before = others[at - 1], after = others[at];
  const off = (f?: LaidFrame) => (f ? Math.abs(py - (f.y + f.h / 2)) : Infinity);
  if (after && (!before || before.y === after.y || off(after) <= off(before))) return { x: after.x - BOARD.gap / 2, y: after.y, w: 0, h: after.h };
  return { x: before!.x + before!.w + BOARD.gap / 2, y: before!.y, w: 0, h: before!.h };
}
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
/** The part of the board in view, and at what zoom. */
interface Seen extends Rect { z: number }
/** A point on the board, to be at a point of the view. */
interface Anchor { bx: number; by: number; sx: number; sy: number }
/** What is being moved, before it is saved: a section to a place (and those not placed yet pinned where they stand), a section's wrap, or a frame. */
type Moving = (
  | { kind: "section"; id: string; x: number; y: number; pin: Record<string, { x: number; y: number }> }
  | { kind: "wrap"; id: string; width: number | null }
  | { kind: "frame"; id: string; x: number; y: number; w: number; h: number; to: { section: string; at: number; py: number } | null }
) & {
  /** The board's box when the move began: it is drawn no smaller until the move ends. */
  keep: Rect;
};
type SectionMove = Extract<Moving, { kind: "section" }>;

/** The sections with what is being moved or wrapped where it would go. */
function shaped(sections: SectionMeta[], shape: Moving | null): SectionMeta[] {
  if (shape?.kind === "section") return sections.map((s) => (s.id === shape.id ? { ...s, x: shape.x, y: shape.y } : shape.pin[s.id] ? { ...s, ...shape.pin[s.id] } : s));
  if (shape?.kind === "wrap") return sections.map((s) => (s.id === shape.id ? { ...s, width: shape.width ?? undefined } : s));
  return sections;
}

// ── pieces: the project's own patterns, Yarn and parts on the sheet ──
/** The project's own things: what pieces are drawn from, and what a new one is picked from. */
interface Things { patterns: Pattern[]; yarn: Yarn[]; parts: Part[] }
async function loadThings(projectId: string): Promise<Things> {
  const [patterns, yarn, parts] = await Promise.all([api.patterns.list(projectId), api.yarn.list(projectId), api.parts.list(projectId)]);
  return { patterns, yarn, parts };
}
/** What can be placed on a sheet from Yarn: pictures and videos. */
const placeable = (y: Yarn) => !y.deletedAt && (y.kind === "image" || y.kind === "video");
/** A part as a pattern of its own, filling it: how the editor and the engine draw one. Named for the part as it is, so it is drawn again only when the part changes. */
const partPattern = (part: Part, w: number, h: number) => ({
  id: `part-${part.id}`, projectId: "", name: part.name, version: part.version, updatedAt: part.updatedAt, durationMs: 0, folder: "", size: { name: "part", w, h },
  stitches: [{ id: "i", kind: "part", x: 0, y: 0, w: 1, h: 1, locked: false, partId: part.id, overrides: {}, partSlots: part.slots }],
}) as unknown as Pattern;
/** How a piece is drawn on the board: by the editor's renderer, as a picture of it, or as a note that its thing has gone. */
type PieceShow =
  | { draw: "page"; pattern: Pattern; ctx: ThumbContext; w: number; h: number }
  | { draw: "img"; src: string }
  | { draw: "gone"; kind: PieceKind };
/** What the person's model is told about a piece, from the thing itself. */
function aboutPiece(p: PieceNow, things: Things | null, projectId: string): About | null {
  if (p.gone || !things) return null;
  if (p.kind === "pattern") { const x = things.patterns.find((v) => v.id === p.id); return x ? aboutPattern(x) : null; }
  if (p.kind === "yarn") { const x = things.yarn.find((v) => v.id === p.id); return x ? aboutYarn(x) : null; }
  const x = things.parts.find((v) => v.id === p.id); return x ? aboutPart(x, projectId) : null;
}
const PIECE_ADD: Record<PieceKind, { title: string; empty: string }> = {
  pattern: { title: "Add a pattern", empty: "This project has no patterns yet." },
  yarn: { title: "Add from Yarn", empty: "There are no pictures or videos in Yarn yet." },
  part: { title: "Add a part", empty: "There are no parts yet." },
};

/** The sheet without its code, kept current: asked again when something changes, and only sent when it did. */
function useSheet(initial: DesignMeta) {
  const [design, setDesign] = useState(initial);
  // The version the board has, and how its pieces looked: a pattern on the sheet changes without the sheet.
  const version = useRef(initial.version);
  const pieces = useRef(initial.pieces ?? "");
  const put = useCallback((d: DesignMeta) => { version.current = d.version; pieces.current = d.pieces ?? ""; setDesign(d); }, []);
  const refresh = useCallback(async () => {
    try {
      const r = await api.designs.board(initial.id, version.current, pieces.current);
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
  // The project's own things, once the sheet has a piece of one or one is being added: what pieces are drawn from.
  const [adding, setAdding] = useState<{ kind: PieceKind; section: SectionMeta } | null>(null);
  const hasPieces = useMemo(() => design.sections.some((s) => s.frames.some((f) => f.piece)), [design]);
  const wantThings = hasPieces || !!adding;
  const { data: things } = useLive(() => (wantThings ? loadThings(projectId) : Promise.resolve(null)), [projectId, wantThings]);
  const thumbs = useMemo(() => (things ? thumbContext(projectId, { swatch, yarn: things.yarn, parts: things.parts }) : null), [things, swatch, projectId]);
  const view = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const boardEl = useRef<HTMLDivElement>(null);

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
      // A piece has no code: it is drawn from its thing.
      if (!m || m.piece || code.current.get(id)?.code === m.code || asked.current.has(`${id}:${m.code}`)) continue;
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

  // Comments: pinned to a spot on a frame, or on the sheet as a whole. The pane beside the board
  // has a knit's tabs: Frame, for the frame picked, and Comments. With a frame picked, its comments
  // come first and the rest of the sheet's are a press away. The pins show on the board all the time.
  const commentsOn: CommentsOn = { kind: "design", projectId, designId: design.id, name: design.name };
  const { threads, refresh: refreshComments } = useComments(commentsOn);
  const cs = useCommentState();
  const [tab, setTab] = useState<"frame" | "comments">("frame");
  const commenting = tab === "comments";
  // The frame whose pane shows all of the sheet's comments, not only its own.
  const [wideFor, setWideFor] = useState<string | null>(null);
  const [askingFrame, setAskingFrame] = useState(false);
  const pinsOf = useMemo(() => {
    const m = new Map<string, typeof threads>();
    for (const t of shownThreads(threads, cs)) if (t.frameId) m.set(t.frameId, [...(m.get(t.frameId) ?? []), t]);
    return m;
  }, [threads, cs]);
  const openComments = threads.filter((t) => !t.resolvedAt).length;
  /** The comments, shown or not. With none yet, shown is ready to place the first. */
  const comment = (on: boolean) => {
    setTab(on ? "comments" : "frame");
    if (on && !threads.length) { cs.setPicking(true); cs.setActive(null); }
    if (!on) { cs.setPicking(false); cs.setDraft(null); cs.setActive(null); }
  };
  /** Pin a comment: the next press on a frame places it. */
  const pinOne = () => { setTab("comments"); cs.setDraft(null); cs.setActive(null); cs.setPicking(true); };
  /** A pin pressed: its frame picked and its thread open. */
  const pickComment = (t: CommentThread) => {
    if (t.frameId && metaOf.has(t.frameId)) setSelected(t.frameId);
    setWideFor(null); setTab("comments"); cs.setPicking(false); cs.setDraft(null); cs.setActive(t.id);
  };
  const next = threads.length ? Math.max(...threads.map((t) => t.n)) + 1 : 1;

  // ── the layout: where every section and frame is, in the frames' pixels ──
  // What is written in the inspector shows on the board a moment after the typing stops, at its size.
  const shownPreview = preview && selected === preview.id && drafts[preview.id] ? preview : null;
  const previewRev = shownPreview ? `p-${hashOf(shownPreview.draft.html + "\0" + shownPreview.draft.css)}-${shownPreview.draft.width}` : null;
  // What is being moved shows where it would go, before it is saved.
  const [moving, setMoving] = useState<Moving | null>(null);
  const shape = moving && moving.kind !== "frame" ? moving : null;
  const shown = useMemo(() => (shownPreview
    ? design.sections.map((s) => ({ ...s, frames: s.frames.map((f) => (f.id === shownPreview.id ? { ...f, name: shownPreview.draft.name, width: shownPreview.draft.width, height: shownPreview.draft.height ?? undefined } : f)) }))
    : design.sections), [design, shownPreview]);
  const sections = useMemo(() => shaped(shown, shape), [shown, shape]);
  const heightOf = useCallback((f: Pick<DesignFrame, "id" | "width" | "height">) => {
    const m = f as FrameMeta;
    const seen = heights[m.id];
    const rev = shownPreview?.id === m.id ? previewRev : frameRev(m);
    return seen && seen.rev === rev ? seen.h : (shownPreview?.id !== m.id && m.measured) || guessHeight(m);
  }, [heights, shownPreview, previewRev]);
  // A section being dragged floats where it is; the others make room once it is put down. While
  // something moves, the board only grows, so the point under the pointer stays under it.
  const lay = useMemo(() => {
    const L = layoutDesign(sections, heightOf, { float: shape?.kind === "section" ? shape.id : undefined });
    const k = moving?.keep;
    if (!k || !L.sections.length) return L;
    const x = Math.min(L.x, k.x), y = Math.min(L.y, k.y);
    return { ...L, x, y, w: Math.max(L.x + L.w, k.x + k.w) - x, h: Math.max(L.y + L.h, k.y + k.h) - y };
  }, [sections, heightOf, shape, moving?.keep]);
  const boxOf = useMemo(() => new Map(lay.sections.flatMap((s) => s.frames.map((f) => [f.id, f] as const))), [lay]);
  // The layout as last drawn, for handlers that run while a drag goes on.
  const layRef = useRef(lay);
  useLayoutEffect(() => { layRef.current = lay; });

  // The zoom that fits the board's width in the window, no bigger than the frames' own size.
  const fit = useMemo(() => (!viewW || !lay.w ? 0.25 : Math.max(ZOOM_MIN, Math.min(1, (viewW - 2 * EDGE) / lay.w))), [lay.w, viewW]);
  const z = zoom === "fit" ? fit : zoom;
  // Room round the board, on screen: half the window, so any frame can be brought to its middle.
  const mx = Math.max(EDGE, Math.round(viewW / 2)), my = Math.max(EDGE, Math.round(viewH / 2));

  useEffect(() => {
    const ro = new ResizeObserver(() => { if (view.current) { setViewW(view.current.clientWidth); setViewH(view.current.clientHeight); } });
    if (view.current) ro.observe(view.current);
    return () => ro.disconnect();
  }, []);

  // ── where the view is on the board ──
  // Where the board was last drawn from: its corner, its zoom and the room round it. Points on the
  // board are worked out from it, so they agree with the screen, even while a pinch runs.
  const drawn = useRef<{ x: number; y: number; z: number; mx: number; my: number } | null>(null);
  /** A point in the view, as a point on the board. */
  const toBoard = (sx: number, sy: number) => {
    const v = view.current!, d = drawn.current ?? { x: lay.x, y: lay.y, z, mx, my };
    return { bx: (v.scrollLeft + sx - d.mx) / d.z + d.x, by: (v.scrollTop + sy - d.my) / d.z + d.y };
  };
  /** The point on the board under the pointer. */
  const boardAt = (cx: number, cy: number) => { const r = view.current!.getBoundingClientRect(); return toBoard(cx - r.left, cy - r.top); };
  /** Scroll so the board's point a.bx, a.by is at a.sx, a.sy in the view. */
  const bring = (a: Anchor) => {
    const v = view.current, d = drawn.current; if (!v || !d) return;
    v.scrollLeft = (a.bx - d.x) * d.z + d.mx - a.sx;
    v.scrollTop = (a.by - d.y) * d.z + d.my - a.sy;
  };

  // The map's box for the view, moved with the view a frame at a time.
  const mapView = useRef<SVGRectElement>(null);
  const mapRaf = useRef(0);
  const mapSoon = () => {
    if (mapRaf.current) return;
    mapRaf.current = requestAnimationFrame(() => {
      mapRaf.current = 0;
      const v = view.current, d = drawn.current, r = mapView.current;
      if (!v || !d || !r) return;
      r.setAttribute("x", String((v.scrollLeft - d.mx) / d.z + d.x)); r.setAttribute("y", String((v.scrollTop - d.my) / d.z + d.y));
      r.setAttribute("width", String(v.clientWidth / d.z)); r.setAttribute("height", String(v.clientHeight / d.z));
    });
  };

  // A zoom can be drawn ahead of React: a pinch or a glide is drawn straight onto the board, and
  // React is told once it stops, so the frames are not all drawn again at every step.
  const zNow = useRef(z);
  const ahead = useRef(false);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const v = view.current, w = wrap.current;
    if (!v || !w || !viewW) return;
    const zz = ahead.current ? zNow.current : z;
    zNow.current = zz;
    w.style.width = `${lay.w * zz + 2 * mx}px`;
    w.style.height = `${lay.h * zz + 2 * my}px`;
    const was = drawn.current;
    if (!was) { v.scrollLeft = mx - EDGE; v.scrollTop = my - EDGE_TOP; }
    else {
      // The board moved under the view (its corner, the window's size, or the fit with it): what
      // was at the view's top left stays there; at the fit, the board's left edge stays at its edge.
      const bx = (v.scrollLeft - was.mx) / was.z + was.x, by = (v.scrollTop - was.my) / was.z + was.y;
      v.scrollLeft = zoom === "fit" && was.z !== zz ? mx - EDGE : (bx - lay.x) * zz + mx;
      v.scrollTop = (by - lay.y) * zz + my;
    }
    drawn.current = { x: lay.x, y: lay.y, z: zz, mx, my };
    mapSoon();
    // Shown once placed: the first scroll is set before the board is seen, so it does not jump.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!ready) setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [z, lay.x, lay.y, lay.w, lay.h, mx, my, viewW]);

  /** Draw the board at zoom zz with the board's a.bx, a.by at a.sx, a.sy, straight away. */
  const paint = (zz: number, a: Anchor) => {
    const v = view.current, w = wrap.current, b = boardEl.current, d = drawn.current;
    if (!v || !w || !b || !d) return;
    const L = layRef.current;
    ahead.current = true;
    zNow.current = zz;
    b.style.transform = `scale(${zz})`;
    b.style.setProperty("--z", String(zz));
    b.style.setProperty("--hz", String(Math.max(zz, HEAD_Z)));
    b.style.setProperty("--az", String(Math.max(zz, ADD_Z)));
    b.toggleAttribute("data-small", zz < LABELS_MIN);
    w.style.width = `${L.w * zz + 2 * d.mx}px`;
    w.style.height = `${L.h * zz + 2 * d.my}px`;
    for (const [k, val] of Object.entries(dotsAt(zz, L.x, L.y, d.mx, d.my))) w.style.setProperty(k, val);
    drawn.current = { x: L.x, y: L.y, z: zz, mx: d.mx, my: d.my };
    bring(a);
    lookSoon();
    mapSoon();
  };
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Tell React the zoom drawn ahead of it, once it has stopped: the fit, or the zoom it is at. */
  const settleZoom = (toFit: boolean, after = SETTLE_MS) => {
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => { ahead.current = false; setZoom(toFit ? "fit" : zNow.current); }, after);
  };
  const gliding = useRef<{ raf: number; goal: number } | null>(null);
  const stopGlide = () => { if (gliding.current) cancelAnimationFrame(gliding.current.raf); gliding.current = null; };
  useEffect(() => () => { clearTimeout(settleTimer.current); if (gliding.current) cancelAnimationFrame(gliding.current.raf); cancelAnimationFrame(mapRaf.current); }, []);
  /** Go to zoom z1 with the board's to.bx, to.by at to.sx, to.sy: a short glide, or at once where motion is reduced. */
  const glide = (z1: number, to: Anchor, toFit: boolean) => {
    const v = view.current; if (!v || !drawn.current) return;
    stopGlide();
    clearTimeout(settleTimer.current);
    const z0 = zNow.current, from = toBoard(to.sx, to.sy);
    if (Math.abs(z1 - z0) < 1e-6 && Math.hypot(from.bx - to.bx, from.by - to.by) * z0 < 1) { ahead.current = false; setZoom(toFit ? "fit" : z1); return; }
    const quick = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Timed from its first frame.
    let t0 = -1;
    const frame = (t: number) => {
      if (t0 < 0) t0 = t;
      const k = quick ? 1 : Math.min(1, (t - t0) / GLIDE_MS), e = 1 - (1 - k) ** 3;
      paint(z0 * Math.pow(z1 / z0, e), { bx: from.bx + (to.bx - from.bx) * e, by: from.by + (to.by - from.by) * e, sx: to.sx, sy: to.sy });
      if (k < 1) gliding.current = { raf: requestAnimationFrame(frame), goal: z1 };
      else { gliding.current = null; settleZoom(toFit, 0); }
    };
    gliding.current = { raf: requestAnimationFrame(frame), goal: z1 };
  };

  /** Zoom to `to`, keeping the point at x, y in the view (its middle, unless given) where it is. To fit is to fit the board's width, its middle to the view's. */
  const zoomTo = (to: number | "fit", x?: number, y?: number) => {
    const v = view.current; if (!v) return;
    const sx = x ?? v.clientWidth / 2, sy = y ?? v.clientHeight / 2;
    if (to === "fit") glide(fit, { bx: lay.x + lay.w / 2, by: toBoard(sx, sy).by, sx: v.clientWidth / 2, sy }, true);
    else glide(clampZ(to), { ...toBoard(sx, sy), sx, sy }, false);
  };
  const step = (dir: 1 | -1) => zoomTo(stepZoom(gliding.current?.goal ?? zNow.current, dir, ZOOM_MIN, ZOOM_MAX));
  /** Part of the board, whole and in the middle of the view, as big as the view holds it, up to `most`. */
  const zoomToBox = (r: Rect, room: number, most = ZOOM_MAX) => {
    const v = view.current; if (!v || !r.w || !r.h) return;
    const want = clampZ(Math.min(most, (v.clientWidth - 2 * room) / r.w, (v.clientHeight - 2 * room - 24) / r.h));
    glide(want, { bx: r.x + r.w / 2, by: r.y + r.h / 2, sx: v.clientWidth / 2, sy: v.clientHeight / 2 + 12 }, false);
  };
  const zoomToFrame = (id: string) => { const f = boxOf.get(id); if (f) zoomToBox(f, FRAME_ROOM); };
  const zoomToSection = (id: string) => { const b = lay.sections.find((x) => x.id === id); if (b) zoomToBox(b, FRAME_ROOM, 1); };
  const zoomToAll = () => zoomToBox(lay, EDGE, 1);

  // Ctrl or Cmd with the wheel, or a pinch, zooms about the pointer, drawn at once. Without, the board scrolls.
  const pinch = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const v = view.current; if (!v || !drawn.current) return;
    stopGlide();
    const r = v.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? v.clientHeight : 1);
    paint(wheelZoom(zNow.current, dy, ZOOM_MIN, ZOOM_MAX), { ...toBoard(sx, sy), sx, sy });
    settleZoom(false);
  };
  const pinchRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    const v = view.current; if (!v) return;
    const on = (e: WheelEvent) => pinchRef.current(e);
    v.addEventListener("wheel", on, { passive: false });
    return () => v.removeEventListener("wheel", on);
  }, []);

  // ── what is seen: drawn live, as pictures, or as outlines ──
  const [seen, setSeen] = useState<Seen | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const look = useCallback(() => {
    const v = view.current, d = drawn.current;
    if (!v || !d) return;
    const r = { x: (v.scrollLeft - d.mx) / d.z + d.x, y: (v.scrollTop - d.my) / d.z + d.y, w: v.clientWidth / d.z, h: v.clientHeight / d.z, z: d.z };
    setSeen((o) => (o && o.z === r.z && Math.abs(o.x - r.x) < 1 && Math.abs(o.y - r.y) < 1 && Math.abs(o.w - r.w) < 1 && Math.abs(o.h - r.h) < 1 ? o : r));
  }, []);
  // Looked at a few times a second while the board moves, not at every step of a scroll or a pinch.
  const lookSoon = useCallback(() => { if (!settle.current) settle.current = setTimeout(() => { settle.current = undefined; look(); }, 100); }, [look]);
  useEffect(() => { if (ready) lookSoon(); }, [ready, z, lay, viewW, viewH, lookSoon]);
  useEffect(() => () => clearTimeout(settle.current), []);
  // At the zoom the board was seen at: ahead of React's while a pinch runs.
  const modes = useMemo(() => (seen ? pickModes(lay, seen, seen.z, selected, pics, noPic) : new Map<string, Mode>()), [seen, lay, selected, pics, noPic]);
  useEffect(() => { need([...modes].filter(([, m]) => m === "live").map(([id]) => id)); }, [modes, need]);
  // How each piece in view is drawn: live by the editor's renderer when it is big on screen, or a
  // picture of it; a Yarn file is its own picture. A piece whose thing has gone says so.
  const shows = useMemo(() => {
    const out = new Map<string, PieceShow>();
    if (!hasPieces) return out;
    const patterns = new Map((things?.patterns ?? []).map((x) => [x.id, x] as const));
    const yarn = new Map((things?.yarn ?? []).map((x) => [x.id, x] as const));
    const parts = new Map((things?.parts ?? []).map((x) => [x.id, x] as const));
    for (const s of design.sections) for (const f of s.frames) {
      const p = f.piece, mode = modes.get(f.id);
      if (!p || !mode) continue;
      if (p.gone) { out.set(f.id, { draw: "gone", kind: p.kind }); continue; }
      if (p.kind === "yarn") {
        const y = yarn.get(p.id);
        const small = y?.meta.thumb ? (y.kind === "image" ? yarnPictureUrl(y) : yarnThumbUrl(y)) : y?.kind === "image" ? yarnFileUrl(y) : null;
        const src = y && (mode === "live" && y.kind === "image" ? yarnFileUrl(y) : small);
        if (src) out.set(f.id, { draw: "img", src });
        continue;
      }
      if (mode !== "live" || !thumbs) continue;
      const part = p.kind === "part" ? parts.get(p.id) : undefined;
      const pattern = p.kind === "pattern" ? patterns.get(p.id) : part ? partPattern(part, p.w, p.h) : undefined;
      if (pattern) out.set(f.id, { draw: "page", pattern, ctx: thumbs, w: p.w, h: p.h });
    }
    return out;
  }, [hasPieces, things, thumbs, design, modes]);

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
    if (d.moved) hush();
  };
  /** The click a drag ends with is not a click: it neither selects nor lets go. */
  const hush = () => { quiet.current = true; setTimeout(() => { quiet.current = false; }, 0); };

  // ── moving sections and frames ──
  // Said to a screen reader as a section moves by the keys.
  const [said, setSaid] = useState("");
  /** At the fit, the zoom stays as it is once something moves, so the board does not zoom as it grows. */
  const hold = () => { if (zoom === "fit") setZoom(zNow.current); };
  /** The board's box as drawn now. */
  const boxNow = (): Rect => { const L = layRef.current; return { x: L.x, y: L.y, w: L.w, h: L.h }; };
  /** Where each section not placed yet stands now, kept there when another is placed, so none of them jumps. */
  const standing = (but: string) => Object.fromEntries(layRef.current.sections.filter((x) => !x.placed && x.id !== but).map((x) => [x.id, { x: Math.round(x.x), y: Math.round(x.y) }]));
  /** A section put somewhere: saves where it is, and where every section it pinned or pushed now stands. */
  const place = async (m: SectionMove) => {
    const now = layoutDesign(shaped(shown, m), heightOf, { first: m.id });
    const was = new Map(design.sections.map((x) => [x.id, x]));
    const ops: DesignOp[] = now.sections.filter((l) => l.placed && (was.get(l.id)?.x !== l.x || was.get(l.id)?.y !== l.y))
      .map((l) => ({ op: "placeSection", section: l.id, x: Math.round(l.x), y: Math.round(l.y) }));
    if (ops.length) await change(ops);
    setMoving(null);
  };
  /** A section dragged by its name, to a place on the grid. */
  const sectionDown = (e: React.PointerEvent, s: SectionMeta) => {
    if (e.button !== 0 || handy) return;
    const b = layRef.current.sections.find((x) => x.id === s.id); if (!b) return;
    const p0 = boardAt(e.clientX, e.clientY), pin = standing(s.id), keep = boxNow();
    let at: { x: number; y: number } | null = null;
    follow(e, (ev) => {
      const p = boardAt(ev.clientX, ev.clientY);
      const x = snapToGrid(b.x + p.bx - p0.bx), y = snapToGrid(b.y + p.by - p0.by);
      if (at && at.x === x && at.y === y) return;
      at = { x, y };
      hold();
      setMoving({ kind: "section", id: s.id, x, y, pin, keep });
    }, (moved) => {
      if (!moved) return;
      hush();
      if (!at || (b.placed && at.x === b.x && at.y === b.y)) { setMoving(null); return; }
      void place({ kind: "section", id: s.id, x: at.x, y: at.y, pin, keep });
    });
  };
  // A section moved by the arrow keys is saved once they stop.
  const nudging = useRef<{ id: string; x: number; y: number; pin: Record<string, { x: number; y: number }>; keep: Rect; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const sectionKeys = (e: React.KeyboardEvent, s: SectionMeta) => {
    const d = ARROWS[e.key];
    if (!d || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    let n = nudging.current;
    if (!n || n.id !== s.id) {
      const b = layRef.current.sections.find((x) => x.id === s.id); if (!b) return;
      n = nudging.current = { id: s.id, x: snapToGrid(b.x), y: snapToGrid(b.y), pin: standing(s.id), keep: boxNow() };
    }
    const k = e.shiftKey ? BOARD.grid * 5 : BOARD.grid;
    n.x += d[0] * k; n.y += d[1] * k;
    hold();
    setMoving({ kind: "section", id: s.id, x: n.x, y: n.y, pin: n.pin, keep: n.keep });
    setSaid(`${s.name} at ${n.x}, ${n.y}`);
    clearTimeout(n.timer);
    const done = n;
    n.timer = setTimeout(() => { if (nudging.current === done) nudging.current = null; void place({ kind: "section", id: done.id, x: done.x, y: done.y, pin: done.pin, keep: done.keep }); }, 600);
  };

  /** How narrow a section can wrap (its widest frame) and how wide its one row is. */
  const wrapRoom = (s: SectionMeta) => ({
    least: Math.max(...s.frames.map((f) => f.width)) + 2 * BOARD.pad,
    row: s.frames.reduce((n, f) => n + f.width, 0) + BOARD.gap * (s.frames.length - 1) + 2 * BOARD.pad,
  });
  /** The width a section wraps at, from a width asked for: on the grid, no narrower than its widest frame, and none once it is one row. */
  const wrapWidth = (s: SectionMeta, w: number) => { const { least, row } = wrapRoom(s); const v = Math.max(least, snapToGrid(w)); return v >= row ? null : v; };
  const wrapTo = async (s: SectionMeta, width: number | null) => {
    if (width !== (s.width ?? null)) await change([{ op: "updateSection", section: s.id, width }]);
    setMoving(null);
  };
  /** A section's right edge dragged in, to wrap its frames into rows; out past one row, to unwrap them. */
  const wrapDown = (e: React.PointerEvent, s: SectionMeta) => {
    if (e.button !== 0 || handy) return;
    const b = layRef.current.sections.find((x) => x.id === s.id); if (!b) return;
    const p0 = boardAt(e.clientX, e.clientY), keep = boxNow();
    let width: number | null | undefined;
    follow(e, (ev) => {
      const w = wrapWidth(s, b.w + boardAt(ev.clientX, ev.clientY).bx - p0.bx);
      if (w === width) return;
      width = w;
      hold();
      setMoving({ kind: "wrap", id: s.id, width: w, keep });
    }, (moved) => {
      if (!moved) return;
      hush();
      if (width === undefined) { setMoving(null); return; }
      void wrapTo(s, width);
    });
  };
  const wrapping = useRef<{ id: string; w: number; keep: Rect; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const wrapKeys = (e: React.KeyboardEvent, s: SectionMeta) => {
    const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!d || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    const { least, row } = wrapRoom(s);
    let n = wrapping.current;
    if (!n || n.id !== s.id) { const b = layRef.current.sections.find((x) => x.id === s.id); if (!b) return; n = wrapping.current = { id: s.id, w: b.w, keep: boxNow() }; }
    n.w = Math.min(row, Math.max(least, n.w + d * (e.shiftKey ? BOARD.grid * 5 : BOARD.grid)));
    const width = wrapWidth(s, n.w);
    hold();
    setMoving({ kind: "wrap", id: s.id, width, keep: n.keep });
    setSaid(width ? `${s.name} wraps at ${width} pixels` : `${s.name} is one row`);
    clearTimeout(n.timer);
    const done = n;
    n.timer = setTimeout(() => { if (wrapping.current === done) wrapping.current = null; void wrapTo(s, width); }, 600);
  };

  /** A frame dragged to another place in its section, or into another. */
  const frameDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || handy || cs.picking) return;
    const from = layRef.current.sections.find((x) => x.frames.some((f) => f.id === id)); if (!from) return;
    const fb = from.frames.find((f) => f.id === id)!, index = from.frames.indexOf(fb);
    const p0 = boardAt(e.clientX, e.clientY), keep = boxNow();
    let to: { section: string; at: number; py: number } | null = null;
    follow(e, (ev) => {
      const p = boardAt(ev.clientX, ev.clientY);
      const sec = layRef.current.sections.find((x) => p.bx >= x.x && p.bx <= x.x + x.w && p.by >= x.y && p.by <= x.y + x.h);
      to = sec ? { section: sec.id, at: dropIndex(sec, id, p.bx, p.by), py: p.by } : null;
      hold();
      setMoving({ kind: "frame", id, x: fb.x + p.bx - p0.bx, y: fb.y + p.by - p0.by, w: fb.w, h: fb.h, to, keep });
    }, (moved) => {
      if (!moved) return;
      hush();
      const t: { section: string; at: number } | null = to;
      if (!t || (t.section === from.id && t.at === index)) { setMoving(null); return; }
      void change([{ op: "moveFrame", frameId: id, section: t.section, at: t.at }]).then(() => setMoving(null));
    });
  };
  const anyPlaced = design.sections.some((x) => x.x != null);
  const tidy = () => void change(design.sections.filter((x) => x.x != null).map((x) => ({ op: "placeSection" as const, section: x.id, x: null, y: null })), "Put the sections back in a column");

  // A section or frame just added is brought into view, at the zoom it is.
  const revealing = useRef<string | null>(null);
  useEffect(() => {
    const id = revealing.current, v = view.current, d = drawn.current;
    if (!id || !v || !d) return;
    const r = lay.sections.find((x) => x.id === id) ?? boxOf.get(id);
    if (!r) return;
    revealing.current = null;
    const vx = (v.scrollLeft - d.mx) / d.z + d.x, vy = (v.scrollTop - d.my) / d.z + d.y, vw = v.clientWidth / d.z, vh = v.clientHeight / d.z;
    const w = Math.min(r.w, vw * 0.8), h = Math.min(r.h, vh * 0.7);
    if (r.x >= vx && r.y - 60 / d.z >= vy && r.x + w <= vx + vw && r.y + h <= vy + vh) return;
    glide(d.z, { bx: r.x + w / 2, by: r.y + h / 2, sx: v.clientWidth / 2, sy: v.clientHeight / 2 }, zoom === "fit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lay, boxOf]);

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
  useLayoutEffect(() => { pinchRef.current = pinch; keysRef.current = onKeys; });
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
  const act = useRef<Act>({ select: () => {}, zoom: () => {}, height: onHeight, comment: () => {}, picFailed, down: () => {} });
  useLayoutEffect(() => {
    act.current.select = (id) => setSelected(id);
    act.current.zoom = zoomToFrame;
    act.current.height = onHeight;
    act.current.picFailed = picFailed;
    act.current.down = frameDown;
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
  const catching = cs.picking && !cs.draft;
  // The pane's first tab is named for what is picked: a frame, or a pattern, Yarn or a part.
  const pickedKind = where?.frame.piece ? PIECE_NAMES[where.frame.piece.kind] : "Frame";
  // With a frame picked, the comments on it, or all of the sheet's when asked.
  const wide = !where || wideFor === where.frame.id;
  const scoped = wide ? threads : threads.filter((t) => t.frameId === where.frame.id);
  const openScoped = scoped.filter((t) => !t.resolvedAt).length;
  // Under the frame picked, while nothing moves and no comment is being placed: what can be done with it.
  const pickedBox = where ? boxOf.get(where.frame.id) : undefined;
  const picked = where && pickedBox && !moving && !cs.picking
    ? { id: where.frame.id, name: where.frame.name, section: where.section.id, x: pickedBox.x + pickedBox.w / 2, y: pickedBox.y + pickedBox.h } : null;
  const barSection = moving?.kind === "frame" && moving.to ? lay.sections.find((x) => x.id === moving.to!.section) : undefined;
  const bar = moving?.kind === "frame" && moving.to && barSection ? dropBar(barSection, moving.id, moving.to.at, moving.to.py) : null;
  // The map shows while the board is bigger than the view.
  const showMap = ready && lay.w > 0 && (lay.w * z > viewW + 1 || lay.h * z > viewH + 1);
  useEffect(() => { if (showMap) mapSoon(); }, [showMap, lay]);

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
          {anyPlaced && <Button size="sm" tip="Puts every section back in one column, in their order. Undo puts them back." onClick={tidy}><LayoutGrid size={14} aria-hidden /> Tidy up</Button>}
        </div>
        <div className="editor-group">
          <IconButton label="Undo" hint="Takes back the last change to the sheet, yours or your model's." disabled={!design.canUndo} onClick={undo}><Undo2 size={16} /></IconButton>
        </div>
        <div className="editor-group">
          <ZoomControls zoom={zoom} scale={z} onZoom={(v) => zoomTo(v)} onStep={step} hand={hand} onHand={setHand} fitLabel="Fit the width" onWhole={zoomToAll}
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
        <div className="design-stage">
        <div className="design-view" ref={view} data-hand={handy || undefined} data-dragging={dragging || undefined} data-moving={moving ? moving.kind : undefined}
          onScroll={() => { lookSoon(); mapSoon(); }}
          onPointerDownCapture={panDownCapture} onPointerDown={panDown} onPointerMove={panMove} onPointerUp={panUp} onPointerCancel={panUp}
          onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
          onClickCapture={(e) => { if (quiet.current) { quiet.current = false; e.stopPropagation(); e.preventDefault(); } }}
          onClick={(e) => { if (!handy && !(e.target as HTMLElement).closest(".design-frame, .design-acts, button, a, [role=menu]")) setSelected(null); }}
          onDoubleClick={(e) => { if (!handy && !(e.target as HTMLElement).closest(NOT_EMPTY)) zoomTo("fit"); }}>
          <div ref={wrap} className="design-wrap" style={{ visibility: ready ? undefined : "hidden", ...dotsAt(z, lay.x, lay.y, mx, my) } as CSSProperties}>
            <div ref={boardEl} className="design-board" data-small={z < LABELS_MIN || undefined} style={{ left: mx, top: my, width: lay.w, height: lay.h, transform: `scale(${z})`, "--z": z, "--hz": Math.max(z, HEAD_Z), "--az": Math.max(z, ADD_Z) } as CSSProperties}>
              {design.sections.map((s, i) => {
                const b = lay.sections[i];
                return (
                  <section key={s.id} className="design-section" aria-labelledby={`sec-${s.id}`} data-moving={(shape && shape.id === s.id) || undefined} style={{ left: b.x - lay.x, top: b.y - lay.y, width: b.w, height: b.h }}>
                    <header>
                      <h2 id={`sec-${s.id}`}><button type="button" className="design-section-name" aria-describedby="design-move-how" onPointerDown={(e) => sectionDown(e, s)} onKeyDown={(e) => sectionKeys(e, s)} onDoubleClick={() => zoomToSection(s.id)}>{s.name}</button></h2>
                      {s.note && <p title={s.note}>{s.note}</p>}
                      <Menu trigger={<IconButton label={`Add to ${s.name}`}><Plus size={14} /></IconButton>} items={[
                        { label: "A frame", hint: "A page or a screen, in code", icon: <FileCode size={14} />, onSelect: () => setAsking({ kind: "frame", section: s }) },
                        { label: "A pattern", hint: "One of the project's patterns, as it is", icon: <Layers size={14} />, onSelect: () => setAdding({ kind: "pattern", section: s }) },
                        { label: "Yarn", hint: "A photo, a logo or a video", icon: <Image size={14} />, onSelect: () => setAdding({ kind: "yarn", section: s }) },
                        { label: "A part", hint: "A saved piece of a pattern", icon: <Shapes size={14} />, onSelect: () => setAdding({ kind: "part", section: s }) },
                      ]} />
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
                        pins={(pins.length > 0 || cs.draft?.frameId === m.id) ? <Pins threads={pins} draft={cs.draft?.frameId === m.id ? cs.draft : null} active={cs.active} onPick={pickComment} /> : null}
                        catching={catching} lifted={moving?.kind === "frame" && moving.id === m.id} piece={shows.get(m.id)} />;
                    })}
                    {picked && picked.section === s.id && (
                      <div className="design-acts" role="toolbar" aria-label={`${picked.name}, picked`} style={{ left: picked.x - b.x, top: picked.y - b.y }}>
                        <button type="button" onClick={() => zoomToFrame(picked.id)}><Maximize2 size={14} aria-hidden /> Zoom to it</button>
                        <button type="button" onClick={pinOne}><MessageSquare size={14} aria-hidden /> Pin a comment</button>
                        <button type="button" onClick={() => setAskingFrame(true)}><Sparkles size={14} aria-hidden /> Ask your model</button>
                      </div>
                    )}
                    {s.frames.length > 1 && <button type="button" className="design-wrap-handle" aria-label={`Wrap ${s.name} into rows`} aria-describedby="design-wrap-how" data-on={s.width != null || undefined}
                      onPointerDown={(e) => wrapDown(e, s)} onKeyDown={(e) => wrapKeys(e, s)} />}
                    {!s.frames.length && <button type="button" className="design-add" style={{ left: BOARD.pad, top: BOARD.pad }} onClick={() => setAsking({ kind: "frame", section: s })}><Plus aria-hidden /> Add a frame</button>}
                  </section>
                );
              })}
              {moving?.kind === "frame" && <>
                <div className="design-ghost" aria-hidden style={{ left: moving.x - lay.x, top: moving.y - lay.y, width: moving.w, height: moving.h }} />
                {bar && <i className="design-drop" aria-hidden style={{ left: bar.x - lay.x, top: bar.y - lay.y, height: bar.h }} />}
              </>}
            </div>
          </div>
        </div>
        {showMap && <BoardMap lay={lay} box={mapView} onGo={(bx, by) => { const v = view.current; if (!v) return; stopGlide(); bring({ bx, by, sx: v.clientWidth / 2, sy: v.clientHeight / 2 }); lookSoon(); mapSoon(); }} />}
        </div>

        {(commenting || where) && (
          <aside className="design-inspector design-pane" aria-label={commenting ? "Comments on the sheet" : `${pickedKind}: ${where!.frame.name}`} aria-busy={(!commenting && !where?.frame.piece && !(draft && full)) || undefined}>
            <Tabs value={commenting ? "comments" : "frame"} onValueChange={(v) => comment(v === "comments")}
              tabs={[...(where ? [{ value: "frame", label: pickedKind }] : []), { value: "comments", label: "Comments", count: openScoped || undefined }]}
              end={<IconButton label={commenting ? "Close the comments" : "Close"} onClick={() => { comment(false); setSelected(null); }}><X size={16} /></IconButton>}>
              {where && (
                <TabPanel value="frame" className="design-panel">
                  {where.frame.piece ? (
                    <PiecePane key={where.frame.id} design={design} projectId={projectId} section={where.section} frame={where.frame as FrameMeta & { piece: PieceNow }} things={things} change={change} onSelect={setSelected} />
                  ) : draft && full ? (
                    <Inspector key={where.frame.id} design={design} projectId={projectId} section={where.section} frame={full} draft={draft} setDraft={setDraft} dirty={dirty}
                      onSave={save} onDiscard={() => { forget(where.frame.id); setPreview(null); }} change={change} onSelect={setSelected} />
                  ) : <>
                    <h2 className="label" style={{ margin: 0 }}>{where.frame.name}</h2>
                    <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Loading its code...</p>
                  </>}
                </TabPanel>
              )}
              <TabPanel value="comments" className="design-panel">
                {where && threads.length > 0 && (
                  <p className="body-sm design-scope">
                    {wide
                      ? <>All {threads.length} on the sheet · <button type="button" className="link" onClick={() => setWideFor(null)}>only those on {where.frame.name}</button></>
                      : <><b>On {where.frame.name}</b> · <button type="button" className="link" onClick={() => setWideFor(where.frame.id)}>all {threads.length} on the sheet</button></>}
                  </p>
                )}
                <CommentThreads on={commentsOn} threads={scoped} c={cs} refresh={refreshComments} wholeWords="sheet" hint="Click the spot on a frame that should change." heading={false} nextN={next}
                  onGo={(t) => { if (t.frameId && metaOf.has(t.frameId)) zoomToFrame(t.frameId); }} />
              </TabPanel>
            </Tabs>
          </aside>
        )}
      </div>
      <AskModelDialog about={askingFrame && where ? (where.frame.piece && aboutPiece(where.frame.piece, things, projectId)) || aboutDesign(projectId, design, where.frame) : null} onOpenChange={(o) => { if (!o) setAskingFrame(false); }} />
      <PieceDialog adding={adding} things={things} thumbs={thumbs} swatch={swatch} projectId={projectId} onClose={() => setAdding(null)}
        onPick={async (kind, id) => {
          if (!adding) return;
          const r = await change([{ op: "addPiece", section: adding.section.id, kind, id }]);
          if (r?.made.frames[0]) { revealing.current = r.made.frames[0]; setSelected(r.made.frames[0]); }
          setAdding(null);
        }} />

      <p id="design-move-how" hidden>Drag it to place the section anywhere on the board, or move it with the arrow keys, further with Shift. A double-click zooms to it.</p>
      <p id="design-wrap-how" hidden>Drag it in, or press the left arrow key, to wrap the section&apos;s frames into rows; out, or the right arrow key, to put them back in one.</p>
      <p className="sr-only" role="status">{said}</p>
      <ModelAtWork right={where || commenting ? 436 : 16} />
      <SectionDialog asking={asking?.kind === "section" ? asking : null} onClose={() => setAsking(null)}
        onDone={async (name, note, s) => {
          const r = await change(s ? [{ op: "updateSection", section: s.id, name, note }] : [{ op: "addSection", name, note }]);
          if (!s && r?.made.sections[0]) revealing.current = r.made.sections[0];
        }} />
      <FrameDialog asking={asking?.kind === "frame" ? asking : null} onClose={() => setAsking(null)}
        onDone={async (s, name, width) => {
          const r = await change([{ op: "setFrame", section: s.id, name, width, ...newFrameCode(name, width) }]);
          if (r?.made.frames[0]) { revealing.current = r.made.frames[0]; setSelected(r.made.frames[0]); }
        }} />
      <ConfirmDialog open={asking?.kind === "delete-section"} onOpenChange={(o) => !o && setAsking(null)} title={`Delete ${asking?.kind === "delete-section" ? asking.section.name : "the section"}?`}
        description={asking?.kind === "delete-section" ? `Its ${asking.section.frames.length} frame${asking.section.frames.length === 1 ? "" : "s"} go with it. Undo brings them back.` : undefined} confirmLabel="Delete the section"
        onConfirm={async () => { if (asking?.kind === "delete-section") await change([{ op: "removeSection", section: asking.section.id }], `Deleted ${asking.section.name}`); setAsking(null); }} />
    </div>
  );
}

type Act = {
  select: (id: string) => void; zoom: (id: string) => void; height: (id: string, rev: string, h: number, keep: boolean) => void;
  comment: (id: string, x: number, y: number) => void; picFailed: (id: string, url: string) => void;
  /** A press on the frame, which may become a drag. */
  down: (e: React.PointerEvent, id: string) => void;
};

/**
 * The board small, in a corner: its sections and frames, and the part of it in view (`box`, moved
 * by the board as the view moves). A press or a drag on it goes there. For the pointer only: the
 * keys, the scroll and the zoom reach everything it does.
 */
function BoardMap({ lay, box, onGo }: { lay: BoardLayout; box: React.RefObject<SVGRectElement | null>; onGo: (bx: number, by: number) => void }) {
  const k = Math.min(MAP_W / lay.w, MAP_H / lay.h);
  const go = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onGo(lay.x + ((e.clientX - r.left) / r.width) * lay.w, lay.y + ((e.clientY - r.top) / r.height) * lay.h);
  };
  return (
    <div className="design-map" aria-hidden>
      <svg width={Math.max(24, Math.round(lay.w * k))} height={Math.max(24, Math.round(lay.h * k))} viewBox={`${lay.x} ${lay.y} ${lay.w} ${lay.h}`} preserveAspectRatio="none"
        onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); go(e); }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) go(e); }}>
        {lay.sections.map((s) => <rect key={s.id} className="design-map-section" x={s.x} y={s.y} width={s.w} height={s.h} />)}
        {lay.sections.map((s) => s.frames.map((f) => <rect key={f.id} className="design-map-frame" x={f.x} y={f.y} width={f.w} height={f.h} />))}
        <rect ref={box} className="design-map-view" />
      </svg>
    </div>
  );
}

/**
 * One frame on the board: its label, the frame drawn live (`doc`), as a picture (`pic`) or as its
 * outline, and the button that selects it. Drawn again only when something it shows changes.
 */
const FrameView = memo(function FrameView({ f, x, y, h, rev, doc, pic, selected, mark, lead, act, pins, catching, lifted, piece }: {
  f: Pick<FrameMeta, "id" | "name" | "width" | "height" | "by" | "piece">; x: number; y: number; h: number; rev: string; doc: string | null; pic: string | null;
  selected: boolean; mark?: Mark; lead: boolean; act: { current: Act };
  /** The comments pinned to it. */
  pins?: ReactNode;
  /** While a comment is placed, a click on the frame places it. */
  catching: boolean;
  /** Being dragged somewhere else. */
  lifted?: boolean;
  /** A piece, drawn from its thing: in place of the frame's own page. */
  piece?: PieceShow;
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
    <figure className="design-frame" data-lifted={lifted || undefined} style={{ left: x, top: y, width: f.width }}>
      <figcaption title={`${f.name}, ${frameSize(f)}${f.by === "model" ? ", by your model" : ""}`}>{f.name}<span>{frameSize(f)}</span>{f.by === "model" && <span>by your model</span>}</figcaption>
      <div className="design-frame-box" data-frame-box={f.id} data-piece={f.piece?.kind} data-drawn={piece?.draw === "page" || doc ? "live" : piece || pic ? "picture" : "outline"} style={{ width: f.width, height: h }}>
        {/* Drawn and nothing more: no scripts run in it, and nothing in it can be focused or clicked. */}
        {piece ? <PieceDrawn piece={piece} name={f.name} width={f.width} />
          : doc ? <iframe ref={ref} title={f.name} inert sandbox="allow-same-origin" srcDoc={doc} style={{ width: f.width, height: h }} onLoad={() => void measure()} />
          : pic ? <img className="design-pic" src={pic} alt="" decoding="async" draggable={false}
            onLoad={(e) => { const i = e.currentTarget; if (!f.height && i.naturalWidth) act.current.height(f.id, rev, Math.round(i.naturalHeight * f.width / i.naturalWidth), false); }}
            onError={() => act.current.picFailed(f.id, pic)} /> : null}
        {/* data-pan-ok: with a frame focused, Space still drags the board about. */}
        <button type="button" className="design-frame-hit" data-pan-ok aria-label={`${f.name}, ${frameSize(f)}`} aria-pressed={selected} onPointerDown={(e) => act.current.down(e, f.id)} onClick={() => act.current.select(f.id)} onDoubleClick={() => act.current.zoom(f.id)} />
        <ModelMark mark={mark} lead={lead} />
        {pins}
        {catching && <PinCatch label={`Place a comment on ${f.name}`} onSpot={(px, py) => act.current.comment(f.id, px, py)} />}
      </div>
    </figure>
  );
});

/** A piece on the board: its thing's own page, by the renderer the editor uses; a picture; or a note that it has gone. */
function PieceDrawn({ piece, name, width }: { piece: PieceShow; name: string; width: number }) {
  if (piece.draw === "gone") return <p className="design-gone" style={{ fontSize: Math.max(16, Math.round(width / 28)) }}>This {piece.kind === "yarn" ? "file is not in Yarn" : `${piece.kind} is not in the project`} any more.</p>;
  if (piece.draw === "img") return <img className="design-pic design-piece-pic" src={piece.src} alt="" decoding="async" draggable={false} />;
  return <PiecePage pattern={piece.pattern} ctx={piece.ctx} w={piece.w} h={piece.h} scale={width / piece.w} title={name} />;
}
/**
 * A pattern or a part, live: the page the editor draws, at its own size, made as wide as the piece.
 * One that moves is shown at the moment everything is in. Drawn again only when the thing changes.
 */
function PiecePage({ pattern, ctx, w, h, scale, title }: { pattern: Pattern; ctx: ThumbContext; w: number; h: number; scale: number; title: string }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doc = useMemo(() => pageFor(pattern, ctx), [pattern.id, pattern.version, pattern.updatedAt, ctx]);
  const at = stillMs(pattern);
  return <iframe title={title} inert tabIndex={-1} srcDoc={doc}
    onLoad={(e) => { if (at) (e.currentTarget.contentWindow as (Window & { __stage?: { seek(ms: number): void } }) | null)?.__stage?.seek(at); }}
    style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none", background: "transparent" }} />;
}

/** A piece, picked: what it is, where to change it, and what to do with it on the sheet. */
function PiecePane({ design, projectId, section, frame, things, change, onSelect }: {
  design: DesignMeta; projectId: string; section: SectionMeta; frame: FrameMeta & { piece: PieceNow }; things: Things | null;
  change: (ops: DesignOp[], said?: string) => Promise<unknown>; onSelect: (id: string | null) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [knitting, setKnitting] = useState(false);
  const [note, setNote] = useState(frame.note ?? "");
  const { kind, id, gone } = frame.piece;
  const pattern = kind === "pattern" ? things?.patterns.find((x) => x.id === id) : undefined;
  const yarn = kind === "yarn" ? things?.yarn.find((x) => x.id === id) : undefined;
  const part = kind === "part" ? things?.parts.find((x) => x.id === id) : undefined;
  const about = aboutPiece(frame.piece, things, projectId);
  const editorHref = `/projects/${projectId}/patterns/${id}`;
  const lead = gone ? `This ${kind === "yarn" ? "file is not in Yarn" : `${kind} is not in the project`} any more, so the sheet shows a note in its place.`
    : kind === "pattern" ? "The pattern itself, drawn as it is now. Change it in the editor, or ask your model, and the sheet shows the change."
    : kind === "part" ? "The part itself, drawn as it is now. A change to it shows here, and each pattern that uses it is offered the change."
    : `A ${yarn?.kind ?? "file"} from Yarn, shown as it is.`;
  const facts = gone ? [] : [
    `${PIECE_NAMES[kind]} · ${frame.piece.w} x ${frame.piece.h}`,
    ...(pattern ? [`${pattern.size.name}`, `${pattern.stitches.length} ${pattern.stitches.length === 1 ? "stitch" : "stitches"}${pattern.durationMs ? `, ${(pattern.durationMs / 1000).toFixed(1)} seconds` : ""}`] : []),
    ...(part ? [`${part.slots.length} ${part.slots.length === 1 ? "slot" : "slots"}${part.builtin ? ", a starter part" : ""}`] : []),
    ...(yarn?.tags.length ? [`Tagged ${yarn.tags.join(", ")}`] : []),
  ];
  const openPart = async () => {
    if (!part) return;
    try { const pat = await api.parts.edit(part.id, projectId); router.push(`/projects/${pat.projectId}/patterns/${pat.id}`); } catch (e) { toast.problem((e as Error).message); }
  };
  return (
    <div className="design-frame-pane">
      <h2 className="label" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{frame.name}</h2>
      <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>In {section.name}. {lead}</p>
      {facts.length > 0 && <ul className="design-facts body-sm">{facts.map((x) => <li key={x}>{x}</li>)}</ul>}
      {!gone && (
        <div className="design-piece-acts">
          {kind === "pattern" && <Link className="btn btn-sm btn-primary" href={editorHref}><ExternalLink size={14} aria-hidden /> Open in the editor</Link>}
          {pattern && <Button size="sm" tip="Real files from the pattern as it is now, into Knits." onClick={() => setKnitting(true)}>Knit</Button>}
          {kind === "yarn" && <Link className="btn btn-sm" href={`/projects/${projectId}/yarn?open=${id}`}><ExternalLink size={14} aria-hidden /> Open in Yarn</Link>}
          {kind === "part" && (part && !part.builtin && part.kind !== "code"
            ? <Button size="sm" variant="primary" tip="Every pattern that uses it is offered the change." onClick={() => void openPart()}><ExternalLink size={14} aria-hidden /> Open in the editor</Button>
            : <Link className="btn btn-sm" href={`/projects/${projectId}/parts`}><ExternalLink size={14} aria-hidden /> Open in Parts</Link>)}
          {about && <AskModelButton size="sm" about={about} />}
        </div>
      )}
      <Field label="Note" htmlFor="piece-note" hint="What it is for, or what to do next. Your model reads it.">
        <Textarea id="piece-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {note !== (frame.note ?? "") && <div><Button size="sm" variant="primary" onClick={() => void change([{ op: "setFrame", section: section.id, frameId: frame.id, note }])}>Save the note</Button></div>}
      <div style={{ display: "grid", gap: "var(--space-2)", borderTop: "1px solid var(--line)", paddingTop: "var(--space-4)" }}>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <a className="btn btn-sm" href={api.designs.pictureUrl(design.id, { frame: frame.id, scale: 2 })}><Download size={14} aria-hidden /> Picture</a>
          <Button size="sm" variant="ghost" tip={`The ${kind === "yarn" ? "file" : kind} itself stays where it is.`}
            onClick={async () => { onSelect(null); await change([{ op: "removeFrame", frameId: frame.id }], `Took ${frame.name} off the sheet`); }}><Trash2 size={14} aria-hidden /> Take it off the sheet</Button>
        </div>
        {design.sections.length > 1 && (
          <Field label="Section" htmlFor="piece-section">
            <Select id="piece-section" value={section.id} onValueChange={(v) => void change([{ op: "moveFrame", frameId: frame.id, section: v }])} options={design.sections.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
        )}
      </div>
      {pattern && <KnitDialog open={knitting} onOpenChange={setKnitting} pattern={pattern} projectId={projectId} editorHref={editorHref} />}
    </div>
  );
}

/** Pick one of the project's patterns, Yarn pictures or parts to put on the sheet, by its picture and name. */
function PieceDialog({ adding, things, thumbs, swatch, projectId, onClose, onPick }: {
  adding: { kind: PieceKind; section: SectionMeta } | null; things: Things | null; thumbs: ThumbContext | null; swatch: Swatch; projectId: string;
  onClose: () => void; onPick: (kind: PieceKind, id: string) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const kind = adding?.kind ?? "pattern";
  const words = q.trim().toLowerCase();
  const all: { id: string; name: string; aside: string; pic: ReactNode }[] = !things ? [] : kind === "pattern"
    ? things.patterns.map((p) => ({ id: p.id, name: p.name, aside: `${p.size.w} x ${p.size.h}`, pic: <span className="piece-pick-fit" style={{ aspectRatio: `${p.size.w} / ${p.size.h}` }}><PatternThumb pattern={p} ctx={thumbs} /></span> }))
    : kind === "yarn"
      ? things.yarn.filter(placeable).map((y) => ({ id: y.id, name: y.name, aside: y.kind === "video" ? "Video" : y.width && y.height ? `${y.width} x ${y.height}` : "Picture", pic: y.meta.thumb || y.kind === "image" ? <img src={y.meta.thumb ? yarnThumbUrl(y) : yarnFileUrl(y)} alt="" loading="lazy" /> : null }))
      : things.parts.map((p) => ({ id: p.id, name: p.name, aside: p.builtin ? "Starter" : `${p.slots.length} ${p.slots.length === 1 ? "slot" : "slots"}`, pic: <PartThumb part={p} swatch={swatch} projectId={projectId} width={200} /> }));
  const found = words ? all.filter((x) => x.name.toLowerCase().includes(words)) : all;
  const shown = found.slice(0, 48);
  const pick = async (id: string) => { setBusy(id); try { await onPick(kind, id); } finally { setBusy(null); } };
  return (
    <Dialog open={!!adding} onOpenChange={(o) => { if (!o) { onClose(); setQ(""); } }} size="lg" title={`${PIECE_ADD[kind].title} to ${adding?.section.name ?? "the section"}`}
      description="It goes on the sheet as it is now, not as a copy: a change to it shows on the sheet too."
      actions={<Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        <Input type="search" aria-label="Find by name" placeholder="Find by name" value={q} onChange={(e) => setQ(e.target.value)} />
        {!things ? <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Loading...</p>
          : !all.length ? <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{PIECE_ADD[kind].empty}</p>
          : !found.length ? <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Nothing is called that.</p>
          : <ul className="piece-picks" aria-label={PIECE_ADD[kind].title}>
              {shown.map((x) => (
                <li key={x.id}>
                  <button type="button" className="piece-pick" disabled={!!busy} aria-busy={busy === x.id || undefined} onClick={() => void pick(x.id)}>
                    <span className="piece-pick-pic" aria-hidden>{x.pic}</span>
                    <span className="piece-pick-name">{x.name}</span><span className="piece-pick-aside">{x.aside}</span>
                  </button>
                </li>
              ))}
            </ul>}
        {found.length > shown.length && <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Showing {shown.length} of {found.length}. Find one by name for the rest.</p>}
      </div>
    </Dialog>
  );
}

function Inspector({ design, projectId, section, frame, draft, setDraft, dirty, onSave, onDiscard, change, onSelect }: {
  design: DesignMeta; projectId: string; section: SectionMeta; frame: DesignFrame; draft: Draft; setDraft: (d: Draft) => void; dirty: boolean;
  onSave: () => void; onDiscard: () => void; change: (ops: DesignOp[], said?: string) => Promise<{ made: { frames: string[] } } | null>; onSelect: (id: string | null) => void;
}) {
  const lint = useMemo(() => lintDesignCode(draft.html, draft.css), [draft.html, draft.css]);
  const errors = lint.filter((l) => l.level === "error");
  const device = deviceOf(draft.width) ?? "custom";
  const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const changedByModel = dirty && frame.by === "model";
  return (
    <div className="design-frame-pane" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); if (dirty && !errors.length) onSave(); } }}>
      <h2 className="label" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{frame.name}</h2>
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
    </div>
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
