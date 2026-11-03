"use client";

import Link from "next/link";
import { useState } from "react";
import { SIZES, type Size } from "@knitted/core";
import { Button, Dialog, Field, IconButton, Input, SegmentedControl, Select, SwatchChip, Wordmark, icons } from "@knitted/ui";
import { useEditor, type EditMode } from "@/lib/editor/store";

const { ArrowLeft, Undo2, Redo2, ZoomIn, ZoomOut, Clock, Command, Film } = icons as unknown as Record<string, React.ComponentType<{ size?: number }>>;
const Clk = Clock ?? Command;

export function TopBar({ projectId, timeline, onTimeline, onHistory, onShortcuts, onKnit, knitting }: { projectId: string; timeline: boolean; onTimeline: () => void; onHistory: () => void; onShortcuts: () => void; onKnit: () => void; knitting?: boolean }) {
  const st = useEditor();
  const { pattern, swatch, mode, status, undoStack, redoStack } = st;
  const [custom, setCustom] = useState(false);
  const sizeValue = SIZES.find((s) => s.w === pattern.size.w && s.h === pattern.size.h)?.name ?? "Custom";
  const zoomPct = Math.round((st.zoom === "fit" ? 0 : st.zoom) * 100);

  return (
    <header style={{ height: "var(--topbar-h)", borderBottom: "1px solid var(--line)", background: "var(--surface)", display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "0 var(--space-4)", flexShrink: 0 }}>
      <Link href={`/projects/${projectId}`} className="icon-btn" aria-label="Back to project" style={{ display: "inline-grid" }}><ArrowLeft size={16} /></Link>
      <Wordmark size={16} />
      <span style={{ color: "var(--line-strong)" }}>/</span>
      <input aria-label="Pattern name" defaultValue={pattern.name} key={pattern.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== pattern.name) st.dispatch({ type: "setMeta", name: v }, { label: "Rename" }); else e.target.value = pattern.name; }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="label" style={{ background: "transparent", border: "1px solid transparent", borderRadius: 6, padding: "4px 6px", color: "var(--ink)", font: "inherit", fontWeight: 600, width: Math.max(8, pattern.name.length + 1) + "ch", maxWidth: 260 }} />
      <span role="status" aria-live="polite" className="body-sm" style={{ color: status === "error" ? "var(--danger)" : "var(--ink-muted)", minWidth: 64 }}>{status === "saving" ? "Saving..." : status === "error" ? "Not saved" : "Saved"}</span>

      <div style={{ flex: 1 }} />
      <SegmentedControl<EditMode> label="Mode" value={mode} onChange={st.setMode} options={[{ value: "pattern", label: "Pattern" }, { value: "fill", label: "Fill" }]} />
      <div style={{ width: 150 }}>
        <Select aria-label="Size" value={sizeValue} onValueChange={(v) => { if (v === "Custom") { setCustom(true); return; } const sz = SIZES.find((s) => s.name === v)!; st.dispatch({ type: "setSize", size: sz }, { label: "Resize" }); }}
          options={[...SIZES.map((s) => ({ value: s.name, label: `${s.name} ${s.w}x${s.h}` })), { value: "Custom", label: sizeValue === "Custom" ? `Custom ${pattern.size.w}x${pattern.size.h}` : "Custom..." }]} />
      </div>
      <IconButton label="Undo" shortcut="Ctrl+Z" disabled={!undoStack.length} onClick={st.undo}><Undo2 size={16} /></IconButton>
      <IconButton label="Redo" shortcut="Shift+Ctrl+Z" disabled={!redoStack.length} onClick={st.redo}><Redo2 size={16} /></IconButton>
      <IconButton label="Zoom out" onClick={() => st.setZoom(Math.max(0.1, (st.zoom === "fit" ? 0.4 : st.zoom) / 1.25))}><ZoomOut size={16} /></IconButton>
      <button className="chip chip-button" onClick={() => st.setZoom("fit")} aria-label="Fit to screen" style={{ minWidth: 56, justifyContent: "center" }}>{st.zoom === "fit" ? "Fit" : `${zoomPct}%`}</button>
      <IconButton label="Zoom in" onClick={() => st.setZoom(Math.min(4, (st.zoom === "fit" ? 0.4 : st.zoom) * 1.25))}><ZoomIn size={16} /></IconButton>
      <IconButton label="Timeline" pressed={timeline} onClick={onTimeline}><Film size={16} /></IconButton>
      <IconButton label="History" onClick={onHistory}><Clk size={16} /></IconButton>
      <IconButton label="Keyboard shortcuts" shortcut="Ctrl+/" onClick={onShortcuts}><Command size={16} /></IconButton>
      <SwatchChip name={swatch.name} colors={swatch.colors.map((c) => c.hex)} />
      <Button variant="primary" onClick={onKnit} disabled={knitting}>{knitting ? "Knitting..." : "Knit"}</Button>

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
