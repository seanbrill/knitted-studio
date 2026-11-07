"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@knitted/core/client";
import { SIZES, type Size } from "@knitted/core";
import { Button, Dialog, Field, IconButton, Input, Menu, SegmentedControl, Select, Tip, Tooltip, icons } from "@knitted/ui";
import { useEditor, type EditMode } from "@/lib/editor/store";
import { useLive } from "@/lib/hooks";
import { ModelPresence } from "../ModelPresence";

const { Undo2, Redo2, ZoomIn, ZoomOut, Clock, Command, Film, ArrowLeft, ChevronRight, MoreHorizontal, Palette } = icons as unknown as Record<string, React.ComponentType<{ size?: number }>>;
const Clk = Clock ?? Command;

/**
 * The editor's bar, in groups: where the pattern is and its name; what it is (mode and size);
 * changes; the view; and Knit. The way back is one button and a short trail above the name,
 * so a long project name and a long pattern name each get their own line instead of sharing one.
 */
export function TopBar({ projectId, timeline, onTimeline, onHistory, onShortcuts, onKnit, knitting }: { projectId: string; timeline: boolean; onTimeline: () => void; onHistory: () => void; onShortcuts: () => void; onKnit: () => void; knitting?: boolean }) {
  const st = useEditor();
  const router = useRouter();
  const { pattern, swatch, mode, status, undoStack, redoStack } = st;
  const [custom, setCustom] = useState(false);
  const { data: project } = useLive(() => api.projects.get(projectId), [projectId]);
  const size = SIZES.find((s) => s.w === pattern.size.w && s.h === pattern.size.h);
  const sizeValue = size?.name ?? "Custom";
  const zoomPct = Math.round((st.zoom === "fit" ? 0 : st.zoom) * 100);
  const base = `/projects/${projectId}`;
  const projectName = project?.name ?? "Project";

  return (
    <header className="editor-bar" style={{ height: "var(--topbar-h)", borderBottom: "1px solid var(--line)", background: "var(--surface)", display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "0 var(--space-3)", flexShrink: 0 }}>
      <Tip text={`Back to the patterns in ${projectName}`}><Link href={base} className="icon-btn" aria-label={`Back to ${projectName}`}><ArrowLeft size={16} /></Link></Tip>
      <div className="editor-title">
        <nav aria-label="Breadcrumbs" className="editor-where body-sm">
          <Link href="/" className="editor-where-link">Projects</Link>
          <ChevronRight size={12} aria-hidden />
          <Link href={base} className="editor-where-link" title={projectName}>{projectName}</Link>
        </nav>
        <div className="editor-name">
          {/* Its own name is where it is renamed. */}
          <input aria-label="Pattern name" aria-current="page" defaultValue={pattern.name} key={pattern.name} title={pattern.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== pattern.name) st.dispatch({ type: "setMeta", name: v }, { label: "Rename" }); else e.target.value = pattern.name; }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="label editor-name-input" style={{ width: Math.max(8, pattern.name.length + 1) + "ch" }} />
          <span role="status" aria-live="polite" className="editor-saved" data-state={status}>{status === "saving" ? "Saving..." : status === "error" ? "Not saved" : "Saved"}</span>
        </div>
      </div>
      {/* What a model is doing gives way first when the bar is full: its words are cut short, never laid over the name. */}
      <span className="editor-presence"><ModelPresence variant="bar" patternId={pattern.id} /></span>

      <div style={{ flex: 1 }} />
      <div className="editor-group roomy">
        <Tip text="Pattern lays out the design. Fill only changes the words and pictures in its open slots, as a batch or your model does.">
          <div><SegmentedControl<EditMode> label="Mode" value={mode} onChange={st.setMode} options={[{ value: "pattern", label: "Pattern" }, { value: "fill", label: "Fill" }]} /></div>
        </Tip>
        <Tip text={`The size it is knitted at: ${pattern.size.w} by ${pattern.size.h} pixels. Custom is any size you like.`}>
          <div className="editor-size">
            <Select aria-label="Size" value={sizeValue} onValueChange={(v) => { if (v === "Custom") { setCustom(true); return; } const sz = SIZES.find((s) => s.name === v)!; st.dispatch({ type: "setSize", size: sz }, { label: "Resize" }); }}
              shown={<span className="editor-size-shown">{size?.name ?? "Custom"}<span className="editor-size-px">{pattern.size.w}x{pattern.size.h}</span></span>}
              options={[...SIZES.map((s) => ({ value: s.name, label: `${s.name} ${s.w}x${s.h}` })), { value: "Custom", label: sizeValue === "Custom" ? `Custom ${pattern.size.w}x${pattern.size.h}` : "Custom..." }]} />
          </div>
        </Tip>
      </div>
      <div className="editor-group">
        <IconButton label="Undo" shortcut="Ctrl+Z" hint="Takes back your last change. A model's changes are left as they are." disabled={!undoStack.length} onClick={st.undo}><Undo2 size={16} /></IconButton>
        <IconButton label="Redo" shortcut="Shift+Ctrl+Z" disabled={!redoStack.length} onClick={st.redo}><Redo2 size={16} /></IconButton>
      </div>
      <div className="editor-group">
        <span className="editor-wide"><IconButton label="Zoom out" shortcut="Ctrl+-" hint="Or pinch, or hold Ctrl and scroll." onClick={() => st.zoomStep(-1)}><ZoomOut size={16} /></IconButton></span>
        <Tooltip label="Fit to screen" shortcut="Ctrl+0" hint={st.zoom === "fit" ? "The whole pattern is in view." : `Shown at ${zoomPct}%. Press to see the whole pattern.`}>
          <button className="chip chip-button" onClick={() => st.setZoom("fit")} aria-label="Fit to screen" style={{ minWidth: 52, justifyContent: "center" }}>{st.zoom === "fit" ? "Fit" : `${zoomPct}%`}</button>
        </Tooltip>
        <span className="editor-wide"><IconButton label="Zoom in" shortcut="Ctrl+=" hint="Or pinch, or hold Ctrl and scroll." onClick={() => st.zoomStep(1)}><ZoomIn size={16} /></IconButton></span>
      </div>
      <div className="editor-group">
        <IconButton label="Timeline" pressed={timeline} hint="When each stitch comes in and goes, for a pattern that plays as a video." onClick={onTimeline}><Film size={16} /></IconButton>
        <IconButton label="History" hint="Every saved change to this pattern, yours and your model's. Go back to any of them." onClick={onHistory}><Clk size={16} /></IconButton>
        {/* The swatch, as its colours: its name and the rest are a click away. */}
        <Menu trigger={<button type="button" className="icon-btn editor-swatch" aria-label={`More: swatch ${swatch.name}, shortcuts`}>
          <span aria-hidden className="editor-swatch-dots">{swatch.colors.slice(0, 3).map((c, i) => <span key={i} style={{ background: c.hex }} />)}</span><MoreHorizontal size={14} />
        </button>} items={[
          { label: `Swatch: ${swatch.name}`, icon: <Palette size={14} />, onSelect: () => router.push(`${base}/swatch`) },
          { label: "Keyboard shortcuts", icon: <Command size={14} />, shortcut: "Ctrl+/", onSelect: onShortcuts },
        ]} />
      </div>
      <Button variant="primary" tip="Makes the finished files from this pattern, as pictures or a video." onClick={onKnit} disabled={knitting}>{knitting ? "Knitting..." : "Knit"}</Button>

      <CustomSize open={custom} onOpenChange={setCustom} current={pattern.size} onApply={(sz) => st.dispatch({ type: "setSize", size: sz }, { label: "Resize" })} />
    </header>
  );
}

function CustomSize({ open, onOpenChange, current, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; current: Size; onApply: (s: Size) => void }) {
  const [w, setW] = useState(String(current.w)); const [h, setH] = useState(String(current.h));
  const bad = !(Number(w) >= 16 && Number(w) <= 8000 && Number(h) >= 16 && Number(h) <= 8000);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Custom size" description="Pixels, between 16 and 8000."
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={bad} onClick={() => { onApply({ name: "Custom", w: Math.round(Number(w)), h: Math.round(Number(h)) }); onOpenChange(false); }}>Apply</Button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Width" htmlFor="cs-w"><Input id="cs-w" mono value={w} onChange={(e) => setW(e.target.value)} /></Field>
        <Field label="Height" htmlFor="cs-h" error={bad ? "Use a size between 16 and 8000." : undefined}><Input id="cs-h" mono value={h} onChange={(e) => setH(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
