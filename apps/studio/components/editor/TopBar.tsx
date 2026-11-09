"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@knitted/core/client";
import { SIZES } from "@knitted/core";
import { Button, IconButton, Menu, SegmentedControl, Select, Tip, icons } from "@knitted/ui";
import { useEditor, type EditMode } from "@/lib/editor/store";
import { useLive } from "@/lib/hooks";
import { ModelPresence } from "../ModelPresence";
import { ZoomControls } from "../ZoomControls";
import { keyText } from "../Shortcuts";
import { CustomSizeDialog } from "../SizeTiles";

const { Undo2, Redo2, Clock, Command, Film, ArrowLeft, ChevronRight, MoreHorizontal, Palette } = icons as unknown as Record<string, React.ComponentType<{ size?: number }>>;
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
  const base = `/projects/${projectId}`;
  const projectName = project?.name ?? "Project";
  // A Part open here: its way back is to Parts, and it is not knitted on its own.
  const isPart = !!pattern.partId;
  const back = isPart ? `${base}/parts` : base;

  return (
    <header className="editor-bar" style={{ height: "var(--topbar-h)", borderBottom: "1px solid var(--line)", background: "var(--surface)", display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "0 var(--space-3)", flexShrink: 0 }}>
      <Tip text={isPart ? `Back to the parts in ${projectName}` : `Back to the patterns in ${projectName}`}><Link href={back} className="icon-btn" aria-label={isPart ? `Back to the parts in ${projectName}` : `Back to ${projectName}`}><ArrowLeft size={16} /></Link></Tip>
      <div className="editor-title">
        <nav aria-label="Breadcrumbs" className="editor-where body-sm">
          <Link href="/" className="editor-where-link">Projects</Link>
          <ChevronRight size={12} aria-hidden />
          <Link href={base} className="editor-where-link" title={projectName}>{projectName}</Link>
          {isPart && <><ChevronRight size={12} aria-hidden /><Link href={back} className="editor-where-link">Parts</Link></>}
        </nav>
        <div className="editor-name">
          {/* Its own name is where it is renamed. */}
          <input aria-label={isPart ? "Part name" : "Pattern name"} aria-current="page" defaultValue={pattern.name} key={pattern.name} title={pattern.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== pattern.name) st.dispatch({ type: "setMeta", name: v }, { label: "Rename" }); else e.target.value = pattern.name; }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="label editor-name-input" style={{ width: Math.max(8, pattern.name.length + 1) + "ch" }} />
          <span role="status" aria-live="polite" className="editor-saved" data-state={status}>{status === "saving" ? "Saving..." : status === "error" ? "Not saved" : "Saved"}</span>
        </div>
      </div>
      {/* What a model is doing gives way first when the bar is full: its words are cut short, never laid over the name. */}
      <span className="editor-presence"><ModelPresence variant="bar" patternId={pattern.id} /></span>

      <div style={{ flex: 1 }} />
      <div className="editor-group roomy">
        {!isPart && <Tip text="Pattern lays out the design. Fill only changes the words and pictures in its open slots, as a batch or your model does.">
          <div><SegmentedControl<EditMode> label="Mode" value={mode} onChange={st.setMode} options={[{ value: "pattern", label: "Pattern" }, { value: "fill", label: "Fill" }]} /></div>
        </Tip>}
        <Tip text={isPart ? `The part's shape: ${pattern.size.w} by ${pattern.size.h}. Where it is used, it keeps its width and takes this shape when the update is accepted.` : `The size it is knitted at: ${pattern.size.w} by ${pattern.size.h} pixels. Custom is any size you like.`}>
          <div className="editor-size">
            <Select aria-label="Size" value={sizeValue} onValueChange={(v) => { if (v === "Custom") { setCustom(true); return; } const sz = SIZES.find((s) => s.name === v)!; st.dispatch({ type: "setSize", size: sz }, { label: "Resize" }); }}
              shown={<span className="editor-size-shown">{size?.name ?? "Custom"}<span className="editor-size-px">{pattern.size.w}x{pattern.size.h}</span></span>}
              options={[...SIZES.map((s) => ({ value: s.name, label: `${s.name} ${s.w}x${s.h}` })), { value: "Custom", label: sizeValue === "Custom" ? `Custom ${pattern.size.w}x${pattern.size.h}` : "Custom..." }]} />
          </div>
        </Tip>
      </div>
      <div className="editor-group">
        <IconButton label="Undo" shortcut={keyText(["mod", "Z"])} hint="Takes back your last change. A model's changes are left as they are." disabled={!undoStack.length} onClick={st.undo}><Undo2 size={16} /></IconButton>
        <IconButton label="Redo" shortcut={keyText(["shift", "mod", "Z"])} disabled={!redoStack.length} onClick={st.redo}><Redo2 size={16} /></IconButton>
      </div>
      <div className="editor-group">
        <ZoomControls zoom={st.zoom} scale={st.zoom === "fit" ? st.fitScale : st.zoom} onZoom={st.setZoom} onStep={st.zoomStep}
          onSelection={st.selection.length ? st.zoomToSelection : undefined} selectionHint="Zoom to selection (select something first)" hand={st.hand} onHand={st.setHand} />
      </div>
      <div className="editor-group">
        <IconButton label="Timeline" pressed={timeline} hint="When each stitch comes in and goes, for a pattern that plays as a video." onClick={onTimeline}><Film size={16} /></IconButton>
        <IconButton label="History" hint="Every saved change to this pattern, yours and your model's. Go back to any of them." onClick={onHistory}><Clk size={16} /></IconButton>
        {/* The swatch, as its colours: its name and the rest are a click away. */}
        <Menu trigger={<button type="button" className="icon-btn editor-swatch" aria-label={`More: swatch ${swatch.name}, shortcuts`}>
          <span aria-hidden className="editor-swatch-dots">{swatch.colors.slice(0, 3).map((c, i) => <span key={i} style={{ background: c.hex }} />)}</span><MoreHorizontal size={14} />
        </button>} items={[
          { label: `Swatch: ${swatch.name}`, icon: <Palette size={14} />, onSelect: () => router.push(`${base}/swatch`) },
          { label: "Keyboard shortcuts", icon: <Command size={14} />, shortcut: keyText(["mod", "/"]), onSelect: onShortcuts },
        ]} />
      </div>
      {isPart
        ? <Tip text="Every change is already saved to the part. Back to Parts."><Link href={back} className="btn btn-primary">Done</Link></Tip>
        : <Button variant="primary" tip="Makes the finished files from this pattern, as pictures or a video." onClick={onKnit} disabled={knitting}>{knitting ? "Knitting..." : "Knit"}</Button>}

      <CustomSizeDialog open={custom} onOpenChange={setCustom} current={pattern.size} what={pattern.name} onApply={(sz) => st.dispatch({ type: "setSize", size: sz }, { label: "Resize" })} />
    </header>
  );
}

