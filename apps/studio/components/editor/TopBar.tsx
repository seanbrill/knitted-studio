"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@knitted/core/client";
import { SIZES, type Size } from "@knitted/core";
import { Breadcrumbs, Button, Dialog, Field, IconButton, Input, SegmentedControl, Select, SwatchChip, Tip, Tooltip, icons } from "@knitted/ui";
import { useEditor, type EditMode } from "@/lib/editor/store";
import { useLive } from "@/lib/hooks";
import { ModelPresence } from "../ModelPresence";

const { Undo2, Redo2, ZoomIn, ZoomOut, Clock, Command, Film } = icons as unknown as Record<string, React.ComponentType<{ size?: number }>>;
const Clk = Clock ?? Command;

export function TopBar({ projectId, timeline, onTimeline, onHistory, onShortcuts, onKnit, knitting }: { projectId: string; timeline: boolean; onTimeline: () => void; onHistory: () => void; onShortcuts: () => void; onKnit: () => void; knitting?: boolean }) {
  const st = useEditor();
  const { pattern, swatch, mode, status, undoStack, redoStack } = st;
  const [custom, setCustom] = useState(false);
  const { data: project } = useLive(() => api.projects.get(projectId), [projectId]);
  const sizeValue = SIZES.find((s) => s.w === pattern.size.w && s.h === pattern.size.h)?.name ?? "Custom";
  const zoomPct = Math.round((st.zoom === "fit" ? 0 : st.zoom) * 100);
  const base = `/projects/${projectId}`;

  return (
    <header className="editor-bar" style={{ height: "var(--topbar-h)", borderBottom: "1px solid var(--line)", background: "var(--surface)", display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "0 var(--space-4)", flexShrink: 0 }}>
      {/* Where this pattern is, each step a way back; its own name, last, is where it is renamed. */}
      <Breadcrumbs linkAs={Link} className="editor-trail" items={[
        { label: "Projects", href: "/projects" },
        { label: project?.name ?? "Project", href: base },
        { label: "Patterns", href: base },
        { label: pattern.name, render: (
          <input aria-label="Pattern name" aria-current="page" defaultValue={pattern.name} key={pattern.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== pattern.name) st.dispatch({ type: "setMeta", name: v }, { label: "Rename" }); else e.target.value = pattern.name; }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="label" style={{ background: "transparent", border: "1px solid transparent", borderRadius: 6, padding: "4px 6px", color: "var(--ink)", font: "inherit", fontWeight: 600, width: Math.max(8, pattern.name.length + 1) + "ch", maxWidth: 260, minWidth: "6ch", flex: "0 1 auto", textOverflow: "ellipsis" }} />
        ) },
      ]} />
      <span role="status" aria-live="polite" className="body-sm" style={{ color: status === "error" ? "var(--danger)" : "var(--ink-muted)", minWidth: 64, flexShrink: 0, whiteSpace: "nowrap" }}>{status === "saving" ? "Saving..." : status === "error" ? "Not saved" : "Saved"}</span>
      {/* What a model is doing gives way first when the bar is full: its words are cut short, never laid over the trail. */}
      <span className="editor-presence"><ModelPresence variant="bar" patternId={pattern.id} /></span>

      <div style={{ flex: 1 }} />
      <Tip text="Pattern lays out the design. Fill only changes the words and pictures in its open slots, as a batch or your model does.">
        <div><SegmentedControl<EditMode> label="Mode" value={mode} onChange={st.setMode} options={[{ value: "pattern", label: "Pattern" }, { value: "fill", label: "Fill" }]} /></div>
      </Tip>
      <Tip text="The size it is knitted at. Custom is any size you like, in pixels.">
      <div style={{ width: 150 }}>
        <Select aria-label="Size" value={sizeValue} onValueChange={(v) => { if (v === "Custom") { setCustom(true); return; } const sz = SIZES.find((s) => s.name === v)!; st.dispatch({ type: "setSize", size: sz }, { label: "Resize" }); }}
          options={[...SIZES.map((s) => ({ value: s.name, label: `${s.name} ${s.w}x${s.h}` })), { value: "Custom", label: sizeValue === "Custom" ? `Custom ${pattern.size.w}x${pattern.size.h}` : "Custom..." }]} />
      </div>
      </Tip>
      <IconButton label="Undo" shortcut="Ctrl+Z" hint="Takes back your last change. A model's changes are left as they are." disabled={!undoStack.length} onClick={st.undo}><Undo2 size={16} /></IconButton>
      <IconButton label="Redo" shortcut="Shift+Ctrl+Z" disabled={!redoStack.length} onClick={st.redo}><Redo2 size={16} /></IconButton>
      <IconButton label="Zoom out" shortcut="Ctrl+-" hint="Or pinch, or hold Ctrl and scroll." onClick={() => st.zoomStep(-1)}><ZoomOut size={16} /></IconButton>
      <Tooltip label="Fit to screen" shortcut="Ctrl+0" hint={st.zoom === "fit" ? "The whole pattern is in view." : `Shown at ${zoomPct}%. Press to see the whole pattern.`}>
        <button className="chip chip-button" onClick={() => st.setZoom("fit")} aria-label="Fit to screen" style={{ minWidth: 56, justifyContent: "center" }}>{st.zoom === "fit" ? "Fit" : `${zoomPct}%`}</button>
      </Tooltip>
      <IconButton label="Zoom in" shortcut="Ctrl+=" hint="Or pinch, or hold Ctrl and scroll." onClick={() => st.zoomStep(1)}><ZoomIn size={16} /></IconButton>
      <IconButton label="Timeline" pressed={timeline} hint="When each stitch comes in and goes, for a pattern that plays as a video." onClick={onTimeline}><Film size={16} /></IconButton>
      <IconButton label="History" hint="Every saved change to this pattern, yours and your model's. Go back to any of them." onClick={onHistory}><Clk size={16} /></IconButton>
      <IconButton label="Keyboard shortcuts" shortcut="Ctrl+/" hint="Every key the editor knows." onClick={onShortcuts}><Command size={16} /></IconButton>
      <Tip text="The swatch this pattern uses: the brand's colours and fonts.">
        <span style={{ display: "inline-flex" }}><SwatchChip name={swatch.name} colors={swatch.colors.map((c) => c.hex)} /></span>
      </Tip>
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
