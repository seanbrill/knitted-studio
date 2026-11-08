"use client";

// A design sheet, open: the board of sections and frames, zoomed to fit or to any size, and
// the selected frame's name, size and code beside it. Every change is saved as a version, so
// Undo walks back through the person's changes and their model's alike. While a model works
// on the sheet, its frames change here as it saves them.

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "@knitted/core/client";
import { DESIGN_DEVICES, deviceOf, frameSize, lintDesignCode, type Design, type DesignDevice, type DesignFrame, type DesignOp, type DesignSection, type Swatch } from "@knitted/core";
import { Button, ConfirmDialog, Dialog, Field, IconButton, Input, Menu, SegmentedControl, Select, Textarea, Tip, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { frameDoc, frameHeight } from "@/lib/design";
import { AskModelButton, aboutDesign } from "./AskModel";
import { ModelPresence } from "./ModelPresence";
import { ModelAtWork } from "./ModelAtWork";
import { ModelMark } from "./ModelMark";
import { leadOf, useMarks, type Mark } from "@/lib/agent";
import { ZoomControls } from "./ZoomControls";
import { stepZoom, typingIn, useSpaceHeld, wheelZoom, zoomKey } from "@/lib/zoom";

const { ArrowLeft, ArrowUp, ArrowDown, ChevronRight, Copy, Download, MoreHorizontal, Pencil, Plus, Trash2, Undo2, X, AlertTriangle } = icons;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 4;
// Round a frame zoomed to: room to see it is the whole frame, and its label.
const FRAME_ROOM = 48;
// Somewhere on the board that is not a frame or a control: a drag there moves the board.
const NOT_EMPTY = ".design-frame-box, button, a, input, textarea, select, [role=menu]";

/**
 * A place on the board to keep where it is on screen while the zoom changes: a point (x, y in the
 * view) and where it falls on the nearest frame, as a part of that frame's width and height.
 * Frames scale with the zoom and the space round them does not, so a frame is what holds still.
 */
interface Anchor { frame: string | null; fx: number; fy: number; x: number; y: number }
// On screen, whatever the zoom: the board's padding, a section's, and the gap between frames.
const AROUND = 2 * 40 + 2 * 24 + 32;
const GAP = 28;
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
  | { kind: "section"; section?: DesignSection }
  | { kind: "frame"; section: DesignSection }
  | { kind: "delete-section"; section: DesignSection };

export function DesignBoard({ projectId, initial, swatch }: { projectId: string; initial: Design; swatch: Swatch }) {
  const toast = useToast();
  const { data, refresh } = useLive(() => api.designs.get(initial.id), [initial.id]);
  const design = data ?? initial;
  const { data: project } = useLive(() => api.projects.get(projectId), [projectId]);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [viewW, setViewW] = useState(0);
  const [hand, setHand] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});
  // What is written in the inspector and not saved yet, by frame: a frame's draft stays its own
  // when another frame is picked, and is there again on going back to it.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [preview, setPreview] = useState<{ id: string; draft: Draft } | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "error">("idle");
  const [asking, setAsking] = useState<Asking | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // The frames a model is designing or looking at, outlined; following it, the newest is brought into view.
  const marks = useMarks((w) => (w.designId === initial.id ? w.frameIds : null));
  const leadFrame = leadOf(marks);
  const where = design.sections.map((section) => ({ section, frame: section.frames.find((x) => x.id === selected) })).find((w): w is { section: DesignSection; frame: DesignFrame } => !!w.frame) ?? null;

  // The zoom that fits the widest section in the window: frames scale, the space round them does not.
  const fit = useMemo(() => {
    if (!viewW) return 0.25;
    const z = Math.min(...design.sections.filter((s) => s.frames.length).map((s) => (viewW - AROUND - (s.frames.length - 1) * GAP) / s.frames.reduce((n, f) => n + f.width, 0)));
    return Math.max(ZOOM_MIN, Math.min(1, Number.isFinite(z) ? z : 1));
  }, [design, viewW]);
  const z = zoom === "fit" ? fit : zoom;
  // The zoom as last asked for: ahead of what is drawn while a pinch runs faster than drawing.
  const zNow = useRef(z);

  // The board is drawn scaled, so the space it scrolls in is sized by hand: its size times the zoom.
  const sizeWrap = useCallback(() => {
    if (!board.current || !wrap.current) return;
    wrap.current.style.width = `${board.current.offsetWidth * zNow.current}px`;
    wrap.current.style.height = `${board.current.offsetHeight * zNow.current}px`;
  }, []);
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (view.current) setViewW(view.current.clientWidth);
      sizeWrap();
    });
    if (view.current) ro.observe(view.current);
    if (board.current) ro.observe(board.current);
    return () => ro.disconnect();
  }, [sizeWrap]);

  // ── zooming about a point: what is under it stays under it ──
  const anchor = useRef<Anchor | null>(null);
  const anchorAt = (x: number, y: number): Anchor | null => {
    const v = view.current; if (!v) return null;
    const r = v.getBoundingClientRect();
    const px = r.left + x, py = r.top + y;
    let best: { el: HTMLElement; d: number } | null = null;
    for (const el of v.querySelectorAll<HTMLElement>("[data-frame-box]")) {
      const b = el.getBoundingClientRect();
      const dx = Math.max(b.left - px, 0, px - b.right), dy = Math.max(b.top - py, 0, py - b.bottom);
      if (!best || dx * dx + dy * dy < best.d) best = { el, d: dx * dx + dy * dy };
    }
    if (!best) return { frame: null, fx: (v.scrollLeft + x) / Math.max(1, v.scrollWidth), fy: (v.scrollTop + y) / Math.max(1, v.scrollHeight), x, y };
    const b = best.el.getBoundingClientRect();
    return { frame: best.el.dataset.frameBox ?? null, fx: (px - b.left) / Math.max(1, b.width), fy: (py - b.top) / Math.max(1, b.height), x, y };
  };
  const toAnchor = (a: Anchor) => {
    const v = view.current; if (!v) return;
    const r = v.getBoundingClientRect();
    const el = a.frame ? v.querySelector<HTMLElement>(`[data-frame-box="${CSS.escape(a.frame)}"]`) : null;
    if (el) {
      const b = el.getBoundingClientRect();
      v.scrollLeft += b.left + a.fx * b.width - (r.left + a.x);
      v.scrollTop += b.top + a.fy * b.height - (r.top + a.y);
    } else {
      v.scrollLeft = a.fx * v.scrollWidth - a.x;
      v.scrollTop = a.fy * v.scrollHeight - a.y;
    }
  };
  useLayoutEffect(() => {
    zNow.current = z;
    sizeWrap();
    const a = anchor.current;
    anchor.current = null;
    if (a) toAnchor(a);
  }, [z]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Zoom to `to`, keeping the point at x, y in the view (its middle, unless given) where it is. */
  const zoomTo = (to: number | "fit", x?: number, y?: number, keep?: Anchor) => {
    const v = view.current;
    const next = to === "fit" ? fit : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, to));
    const a = keep ?? anchorAt(x ?? (v?.clientWidth ?? 0) / 2, y ?? (v?.clientHeight ?? 0) / 2);
    setZoom(to === "fit" ? "fit" : next);
    if (Math.abs(next - zNow.current) < 1e-6) { if (keep) toAnchor(keep); return; }
    zNow.current = next;
    anchor.current = a;
  };
  const step = (dir: 1 | -1) => zoomTo(stepZoom(z, dir, ZOOM_MIN, ZOOM_MAX));
  /** A frame, whole and in the middle of the view, as big as the view holds it. */
  const zoomToFrame = (id: string) => {
    const v = view.current;
    const f = design.sections.flatMap((s) => s.frames).find((x) => x.id === id);
    if (!v || !f) return;
    const h = f.height ?? heights[f.id] ?? Math.round(f.width * 0.625);
    const want = Math.min((v.clientWidth - 2 * FRAME_ROOM) / f.width, (v.clientHeight - 2 * FRAME_ROOM - 24) / h);
    zoomTo(want, undefined, undefined, { frame: id, fx: 0.5, fy: 0.5, x: v.clientWidth / 2, y: v.clientHeight / 2 + 12 });
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
  const base = where ? draftOf(where.frame) : null;
  const written = where ? drafts[where.frame.id] : undefined;
  const draft = written ?? base;
  const dirty = !!(written && base && !same(written, base));
  const forget = (id: string) => setDrafts(({ [id]: _, ...rest }) => rest);
  const setDraft = (d: Draft) => {
    if (!where || !base) return;
    const id = where.frame.id;
    if (same(d, base)) forget(id); else setDrafts((m) => ({ ...m, [id]: d }));
  };
  // What is being written shows on the board a moment after the typing stops.
  useEffect(() => {
    if (!dirty || !selected || !written) return;
    const t = setTimeout(() => setPreview({ id: selected, draft: written }), 400);
    return () => clearTimeout(t);
  }, [written, dirty, selected]);

  const change = useCallback(async (ops: DesignOp[], said?: string) => {
    setSaving("saving");
    try {
      const r = await api.designs.change(design.id, ops);
      await refresh();
      setSaving("idle");
      if (said) toast(said, { label: "Undo", onClick: () => void api.designs.undo(design.id).then(refresh) });
      return r;
    } catch (e) { setSaving("error"); toast((e as Error).message); return null; }
  }, [design.id, refresh, toast]);

  const undo = async () => { try { await api.designs.undo(design.id); await refresh(); } catch (e) { toast((e as Error).message); } };
  const save = async () => {
    if (!where || !draft) return;
    const r = await change([{ op: "setFrame", section: where.section.id, frameId: where.frame.id, name: draft.name, width: draft.width, height: draft.height, note: draft.note, html: draft.html, css: draft.css }]);
    if (r) { forget(where.frame.id); setPreview(null); }
  };

  const projectName = project?.name ?? "Project";
  const home = `/projects/${projectId}`;
  const sectionMenu = (s: DesignSection, i: number) => [
    { label: "Rename", icon: <Pencil size={14} />, onSelect: () => setAsking({ kind: "section", section: s }) },
    { label: "Move up", icon: <ArrowUp size={14} />, disabled: i === 0, onSelect: () => void change([{ op: "moveSection", section: s.id, to: i - 1 }]) },
    { label: "Move down", icon: <ArrowDown size={14} />, disabled: i === design.sections.length - 1, onSelect: () => void change([{ op: "moveSection", section: s.id, to: i + 1 }]) },
    { label: "Download as a picture", icon: <Download size={14} />, disabled: !s.frames.length, onSelect: () => { window.location.href = api.designs.pictureUrl(design.id, { section: s.id }); } },
    { label: "Delete the section", icon: <Trash2 size={14} />, danger: true, onSelect: () => (s.frames.length ? setAsking({ kind: "delete-section", section: s }) : void change([{ op: "removeSection", section: s.id }], `Deleted ${s.name}`)) },
  ];

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
          onPointerDownCapture={panDownCapture} onPointerDown={panDown} onPointerMove={panMove} onPointerUp={panUp} onPointerCancel={panUp}
          onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
          onClickCapture={(e) => { if (quiet.current) { quiet.current = false; e.stopPropagation(); e.preventDefault(); } }}
          onClick={(e) => { if (!handy && !(e.target as HTMLElement).closest(".design-frame, button, a, [role=menu]")) setSelected(null); }}
          onDoubleClick={(e) => { if (!handy && !(e.target as HTMLElement).closest(NOT_EMPTY)) zoomTo("fit"); }}>
          <div ref={wrap}>
            <div ref={board} className="design-board" style={{ transform: `scale(${z})`, "--z": z } as CSSProperties}>
              {design.sections.map((s, i) => (
                <section key={s.id} className="design-section" aria-labelledby={`sec-${s.id}`}>
                  <header>
                    <h2 id={`sec-${s.id}`}>{s.name}</h2>
                    {s.note && <p title={s.note}>{s.note}</p>}
                    <span style={{ flex: 1 }} />
                    <IconButton label={`Add a frame to ${s.name}`} onClick={() => setAsking({ kind: "frame", section: s })}><Plus size={14} /></IconButton>
                    <Menu trigger={<IconButton label={`Actions for ${s.name}`}><MoreHorizontal size={14} /></IconButton>} items={sectionMenu(s, i)} />
                  </header>
                  <div className="design-frames">
                    {s.frames.map((f) => {
                      const p = preview?.id === f.id && selected === f.id && drafts[f.id] ? preview.draft : null;
                      const shown = p ? { ...f, ...p, height: p.height ?? undefined } : f;
                      return <FrameView key={f.id} f={shown} doc={frameDoc(shown, swatch, projectId)} height={heights[f.id]} selected={selected === f.id} mark={marks.get(f.id)} lead={leadFrame === f.id}
                        onSelect={() => setSelected(f.id)} onZoom={() => zoomToFrame(f.id)} onHeight={(h) => setHeights((m) => (m[f.id] === h ? m : { ...m, [f.id]: h }))} />;
                    })}
                    {!s.frames.length && <button type="button" className="design-add" onClick={() => setAsking({ kind: "frame", section: s })}><Plus aria-hidden /> Add a frame</button>}
                  </div>
                </section>
              ))}
              <button type="button" className="design-add" style={{ justifySelf: "start" }} onClick={() => setAsking({ kind: "section" })}><Plus aria-hidden /> Add a section</button>
            </div>
          </div>
        </div>

        {where && draft && (
          <Inspector key={where.frame.id} design={design} projectId={projectId} section={where.section} frame={where.frame} draft={draft} setDraft={setDraft} dirty={dirty}
            onSave={save} onDiscard={() => { forget(where.frame.id); setPreview(null); }} onClose={() => setSelected(null)}
            change={change} onSelect={setSelected} />
        )}
      </div>

      <ModelAtWork right={where ? 436 : 16} />
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

/** One frame on the board: its label, the frame drawn as a page, and the button that selects it. */
function FrameView({ f, doc, height, selected, mark, lead, onSelect, onZoom, onHeight }: { f: DesignFrame; doc: string; height?: number; selected: boolean; mark?: Mark; lead: boolean; onSelect: () => void; onZoom: () => void; onHeight: (h: number) => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const h = f.height ?? height ?? Math.round(f.width * 0.625);
  return (
    <figure className="design-frame" style={{ width: f.width }}>
      <figcaption title={`${f.name}, ${frameSize(f)}${f.by === "model" ? ", by your model" : ""}`}>{f.name}<span>{frameSize(f)}</span>{f.by === "model" && <span>by your model</span>}</figcaption>
      <div className="design-frame-box" data-frame-box={f.id} style={{ width: f.width, height: h }}>
        {/* Drawn and nothing more: no scripts run in it, and nothing in it can be focused or clicked. */}
        <iframe ref={ref} title={f.name} inert sandbox="allow-same-origin" srcDoc={doc} style={{ width: f.width, height: h }}
          onLoad={async () => { if (!f.height && ref.current) { const m = await frameHeight(ref.current); if (m) onHeight(m); } }} />
        {/* data-pan-ok: with a frame focused, Space still drags the board about. */}
        <button type="button" className="design-frame-hit" data-pan-ok aria-label={`${f.name}, ${frameSize(f)}`} aria-pressed={selected} onClick={onSelect} onDoubleClick={onZoom} />
        <ModelMark mark={mark} lead={lead} />
      </div>
    </figure>
  );
}

function Inspector({ design, projectId, section, frame, draft, setDraft, dirty, onSave, onDiscard, onClose, change, onSelect }: {
  design: Design; projectId: string; section: DesignSection; frame: DesignFrame; draft: Draft; setDraft: (d: Draft) => void; dirty: boolean;
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

function SectionDialog({ asking, onClose, onDone }: { asking: { section?: DesignSection } | null; onClose: () => void; onDone: (name: string, note: string, s?: DesignSection) => Promise<void> }) {
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

function FrameDialog({ asking, onClose, onDone }: { asking: { section: DesignSection } | null; onClose: () => void; onDone: (s: DesignSection, name: string, width: number) => Promise<void> }) {
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
