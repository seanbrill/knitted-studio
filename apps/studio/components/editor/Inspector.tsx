"use client";

import { useMemo } from "react";
import { api, yarnThumbUrl } from "@knitted/core/client";
import { resolveStyle, toPx, toFrac, type Command, type Stitch } from "@knitted/core";
import { Button, Field, Input, SegmentedControl, Select, Slider, Switch, Textarea, icons } from "@knitted/ui";
import { liveStitches, useEditor } from "@/lib/editor/store";
import { NumberField, Section, TokenColor } from "./controls";
import { PartInstanceInspector } from "./PartsUI";
import { byFolder } from "../Folders";
import { addClip } from "./Timeline";
import { PRESETS } from "@knitted/core";

const { AlignHorizontalJustifyStart, Trash2, Lock, Unlock } = icons as unknown as Record<string, React.ComponentType<{ size?: number }>>;
void AlignHorizontalJustifyStart; void Lock; void Unlock;

const WEIGHTS = [300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: String(w), label: String(w) }));
const ALIGN_TIP = { left: "Against the left edge of the frame.", center: "In the middle, from left to right.", right: "Against the right edge of the frame.", top: "Against the top edge of the frame.", middle: "In the middle, from top to bottom.", bottom: "Against the bottom edge of the frame." } as const;

export function Inspector({ fonts, onSavePart }: { fonts: string[]; onSavePart?: () => void }) {
  const st = useEditor();
  const { pattern, swatch, selection, yarn } = st;
  const all = liveStitches(st);
  const sel = all.filter((s) => selection.includes(s.id));
  const W = pattern.size.w, H = pattern.size.h;
  const images = useMemo(() => Object.values(yarn).filter((y) => y.kind === "image" || y.kind === "video"), [yarn]);

  if (sel.length === 0) {
    return (
      <aside aria-label="Inspector" className="inspector">
        <p className="eyebrow">Nothing selected</p>
        <p className="body-sm" style={{ color: "var(--ink-muted)", marginTop: 12 }}>Pick a stitch on the canvas. Dashed outlines are locked by the pattern; solid ones are yours to change.</p>
        <Section title="Pattern" hint="Its name, and the size it is knitted at.">
          <Field label="Name" htmlFor="pat-name"><Input id="pat-name" defaultValue={pattern.name} key={pattern.name} onBlur={(e) => e.target.value.trim() && e.target.value !== pattern.name && st.dispatch({ type: "setMeta", name: e.target.value }, { label: "Rename" })} /></Field>
          <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{pattern.size.name}, {W} x {H}. {pattern.stitches.length} stitches.</p>
        </Section>
      </aside>
    );
  }

  const one = sel.length === 1 ? sel[0] : null;
  const first = sel[0];
  const rs = resolveStyle(swatch, first.style);
  const same = <T,>(f: (s: Stitch) => T): T | undefined => (sel.every((s) => f(s) === f(first)) ? f(first) : undefined);

  const patchEach = (fn: (s: Stitch) => Partial<Stitch>, label: string) => {
    const cmds: Command[] = sel.map((s) => ({ type: "updateStitch", id: s.id, patch: fn(s) as never }));
    st.dispatch(cmds.length === 1 ? cmds[0] : { type: "batch", commands: cmds }, { label, coalesce: true });
  };
  const setStyle = (patch: Record<string, string | number | undefined>, label = "Style") =>
    patchEach((s) => { const style = { ...(s.style ?? {}) } as Record<string, string | number>; for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete style[k]; else style[k] = v; } return { style }; }, label);
  /** Slider helpers: preview while dragging, save once on release. */
  const live = (patch: Record<string, string | number>) => st.setDraft(Object.fromEntries(sel.map((s) => [s.id, { style: { ...(s.style ?? {}), ...patch } }])));
  const commit = (patch: Record<string, string | number>) => { st.setDraft(null); setStyle(patch); };
  const sl = (label: string, key: string, def: number, min: number, max: number, step: number, unit?: string, scaleBy = 1) => (
    <Slider label={label} value={Number(rs[key] ?? def) * scaleBy} min={min} max={max} step={step} unit={unit}
      onChange={(v) => live({ [key]: v / scaleBy })} onCommit={(v) => commit({ [key]: v / scaleBy })} />
  );

  const box = one ? toPx(one, pattern.size, Number(rs.rotate ?? 0)) : null;
  const setBox = (p: Partial<{ x: number; y: number; w: number; h: number; rotate: number }>) => {
    if (!one || !box) return;
    const nb = { ...box, ...p };
    const patch: Partial<Stitch> = toFrac(nb, pattern.size);
    if (p.rotate !== undefined) patch.style = { ...(one.style ?? {}), rotate: p.rotate };
    st.dispatch({ type: "updateStitch", id: one.id, patch }, { label: "Position", coalesce: true });
  };

  const align = (how: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
    const cmds: Command[] = sel.map((s) => {
      const p: Partial<Stitch> = how === "left" ? { x: 0 } : how === "center" ? { x: (1 - s.w) / 2 } : how === "right" ? { x: 1 - s.w } : how === "top" ? { y: 0 } : how === "middle" ? { y: (1 - s.h) / 2 } : { y: 1 - s.h };
      return { type: "updateStitch", id: s.id, patch: p };
    });
    st.dispatch({ type: "batch", commands: cmds }, { label: "Align" });
  };

  const isText = same((s) => s.kind) === "text";
  const isMedia = same((s) => s.kind) === "image" || same((s) => s.kind) === "video";
  const isShape = same((s) => s.kind) === "shape";
  const fontOptions = [{ value: "$font.display", label: "Brand headline" }, { value: "$font.body", label: "Brand body" }, { value: "$font.mono", label: "Brand label" }, ...fonts.map((f) => ({ value: f, label: f }))];

  return (
    <aside aria-label="Inspector" className="inspector">
      <p className="eyebrow">{one ? one.slot ?? one.kind : `${sel.length} stitches`}</p>
      <h2 className="h3" style={{ margin: "4px 0 var(--space-3)" }}>{one ? (one.kind === "text" ? "Text" : one.kind[0].toUpperCase() + one.kind.slice(1)) : "Selection"}</h2>

      {one && box && (
        <Section title="Position and size" hint="Where it sits and how big it is, in the pattern's pixels. R turns it.">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <NumberField label="X" value={box.x} onCommit={(v) => setBox({ x: v })} suffix="px" />
            <NumberField label="Y" value={box.y} onCommit={(v) => setBox({ y: v })} suffix="px" />
            <NumberField label="W" value={box.w} min={8} onCommit={(v) => setBox({ w: v })} suffix="px" />
            <NumberField label="H" value={box.h} min={8} onCommit={(v) => setBox({ h: v })} suffix="px" />
            <NumberField label="R" value={box.rotate ?? 0} min={-180} max={180} onCommit={(v) => setBox({ rotate: v })} suffix="deg" />
          </div>
        </Section>
      )}
      <Section title="Align to frame" hint="Lines what is selected up with an edge or the middle of the pattern." defaultOpen={false}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {(["left", "center", "right", "top", "middle", "bottom"] as const).map((a) => <Button key={a} size="sm" tip={ALIGN_TIP[a]} onClick={() => align(a)}>{a[0].toUpperCase() + a.slice(1)}</Button>)}
        </div>
      </Section>

      {one && (
        <Section title="Slot" hint="A named place that Fill mode, a batch or your model writes into.">
          <Field label="Slot name" hint="What a model or a batch fills. Lowercase, like headline." htmlFor="slot-name">
            <Input id="slot-name" mono defaultValue={one.slot ?? ""} key={`${one.id}-${one.slot}`} placeholder="no slot"
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (one.slot ?? "")) st.dispatch({ type: "updateStitch", id: one.id, patch: { slot: v || undefined } as never }, { label: "Slot name" }); }} />
          </Field>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span className="body-sm">Locked to the pattern<br /><span style={{ color: "var(--ink-muted)" }}>Fill mode and models cannot change it.</span></span>
            <Switch label="Locked to the pattern" checked={one.locked} onCheckedChange={(locked) => st.dispatch({ type: "setLocked", id: one.id, locked }, { label: locked ? "Lock" : "Unlock" })} />
          </label>
        </Section>
      )}
      {!one && <Section title="Slot" hint="Locked stitches stay as the pattern has them when it is filled."><label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="body-sm">Locked to the pattern</span><Switch label="Locked to the pattern" checked={sel.every((s) => s.locked)} onCheckedChange={(locked) => st.dispatch({ type: "batch", commands: sel.map((s) => ({ type: "setLocked" as const, id: s.id, locked })) }, { label: locked ? "Lock" : "Unlock" })} /></label></Section>}

      {one?.kind === "part" && <Section title="Part" hint="A reusable piece. Fill its slots here, or detach it to change it freely."><PartInstanceInspector stitch={one} /></Section>}

      {isText && (
        <Section title="Text" hint="The words, their font, and how they sit in their box.">
          {one && <Field label="Content" htmlFor="txt-content"><Textarea id="txt-content" rows={3} defaultValue={one.content} key={`${one.id}-${one.content}`} onBlur={(e) => e.target.value !== one.content && st.dispatch({ type: "updateStitch", id: one.id, patch: { content: e.target.value } }, { label: "Edit text" })} /></Field>}
          <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Wrap one word in *stars* for the serif accent.</p>
          <Field label="Font"><Select aria-label="Font" value={String(first.style?.fontFamily ?? "$font.display")} onValueChange={(v) => setStyle({ fontFamily: v })} options={fontOptions} /></Field>
          <NumberField label="Size" value={Math.round(Number(rs.fontSize ?? 0.05) * W)} min={8} max={800} suffix="px" onCommit={(v) => setStyle({ fontSize: Math.round((v / W) * 10000) / 10000 })} />
          <Field label="Weight"><Select aria-label="Weight" value={String(rs.fontWeight ?? 700)} onValueChange={(v) => setStyle({ fontWeight: Number(v) })} options={WEIGHTS} /></Field>
          {sl("Line height", "lineHeight", 1.05, 0.7, 2, 0.05)}
          {sl("Letter spacing", "letterSpacing", -0.02, -0.1, 0.4, 0.01, "em")}
          <SegmentedControl label="Align" value={String(rs.textAlign ?? "left")} onChange={(v) => setStyle({ textAlign: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }]} />
          <SegmentedControl label="Vertical" value={String(rs.verticalAlign ?? "top")} onChange={(v) => setStyle({ verticalAlign: v })} options={[{ value: "top", label: "Top" }, { value: "middle", label: "Middle" }, { value: "bottom", label: "Bottom" }]} />
          <Field label="Case"><Select aria-label="Case" value={String(rs.textTransform ?? "none")} onValueChange={(v) => setStyle({ textTransform: v === "none" ? undefined : v })} options={[{ value: "none", label: "As typed" }, { value: "uppercase", label: "UPPERCASE" }, { value: "capitalize", label: "Capitalise" }]} /></Field>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="body-sm">Shrink to fit the box</span><Switch label="Shrink to fit" checked={rs.fit === "shrink"} onCheckedChange={(v) => setStyle({ fit: v ? "shrink" : undefined })} /></label>
          <TokenColor label="Text colour" value={first.style?.color as string | undefined} swatch={swatch} onChange={(v) => setStyle({ color: v ?? "$color.text" })} />
        </Section>
      )}

      {isMedia && (
        <Section title={same((s) => s.kind) === "video" ? "Video" : "Image"} hint="Which file from Yarn, how it fills its box, and how it is graded.">
          <Field label="Yarn">
            <Select aria-label="Yarn" value={first.yarnId ?? ""} onValueChange={(v) => patchEach(() => ({ yarnId: v }), "Set image")} options={byFolder(images, (y) => ({ value: y.id, label: y.name }))} placeholder="Choose from Yarn" />
          </Field>
          {first.yarnId && yarn[first.yarnId] && <img src={yarnThumbUrl(yarn[first.yarnId])} alt="" style={{ width: "100%", maxHeight: 120, objectFit: "contain", background: "var(--surface-sunken)", borderRadius: 6 }} />}
          {first.yarnId && !yarn[first.yarnId] && <p className="field-error">That yarn was deleted. Choose another.</p>}
          <SegmentedControl label="Fit" value={String(rs.fit ?? "cover")} onChange={(v) => setStyle({ fit: v })} options={[{ value: "cover", label: "Cover" }, { value: "contain", label: "Contain" }, { value: "fill", label: "Fill" }]} />
          {sl("Focus left to right", "focalX", 0.5, 0, 1, 0.01, undefined, 100)}
          {sl("Focus top to bottom", "focalY", 0.5, 0, 1, 0.01, undefined, 100)}
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="body-sm">Flip</span><Switch label="Flip horizontally" checked={!!rs.flipX} onCheckedChange={(v) => setStyle({ flipX: v ? 1 : undefined })} /></label>
          <Field label="Heat grade" hint="Desaturates, then multiplies with the brand's orange or red.">
            <SegmentedControl label="Heat grade" value={String(rs.heat ?? "none")} onChange={(v) => setStyle({ heat: v === "none" ? undefined : v })} options={[{ value: "none", label: "None" }, { value: "ember", label: "Ember" }, { value: "red", label: "Red" }]} />
          </Field>
          {rs.heat && sl("Heat strength", "heatStrength", 0.7, 0, 1, 0.05, "%", 100)}
          {sl("Brightness", "brightness", 1, 0.2, 2, 0.05)}
          {sl("Contrast", "contrast", 1, 0.2, 2, 0.05)}
          {sl("Saturation", "saturate", 1, 0, 2, 0.05)}
          {sl("Blur", "blur", 0, 0, 40, 1, "px")}
        </Section>
      )}

      {(isShape || isMedia) && (
        <Section title="Fill" hint="The colour inside it, from the swatch." defaultOpen={isShape}>
          <TokenColor label="Fill colour" value={first.style?.background as string | undefined} swatch={swatch} allowNone onChange={(v) => setStyle({ background: v })} />
        </Section>
      )}

      {one && (
        <Section title="Animate" hint="How it comes in and goes, when the pattern plays as a video." defaultOpen={false}>
          <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Adds an animation at the playhead, then drag it on the timeline.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {PRESETS.filter((p) => (!p.text || one.kind === "text") && (!p.image || one.kind === "image" || one.kind === "video")).map((p) => (
              <Button key={p.id} size="sm" onClick={() => addClip(one.id, p.id)}>{p.label}</Button>
            ))}
          </div>
        </Section>
      )}

      <Section title="Style" hint="How see-through it is, its corners, border and shadow." defaultOpen={false}>
        {sl("Opacity", "opacity", 1, 0, 1, 0.01, "%", 100)}
        {sl("Corner radius", "radius", 0, 0, 0.2, 0.002, "%", 100)}
        {sl("Border", "borderWidth", 0, 0, 0.03, 0.001, "%", 100)}
        {Number(rs.borderWidth ?? 0) > 0 && <TokenColor label="Border colour" value={first.style?.borderColor as string | undefined} swatch={swatch} onChange={(v) => setStyle({ borderColor: v })} />}
        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="body-sm">Shadow</span><Switch label="Shadow" checked={!!rs.shadow} onCheckedChange={(v) => setStyle({ shadow: v ? 1 : undefined })} /></label>
      </Section>

      <div style={{ marginTop: "var(--space-4)", display: "grid", gap: 8 }}>
        {onSavePart && <Button block tip="Keeps what is selected as a part, to add to any pattern." onClick={onSavePart}>Save as part</Button>}
        <Button variant="danger" block tip="Takes what is selected off the canvas. Undo brings it back." onClick={() => st.dispatch({ type: "batch", commands: sel.map((s) => ({ type: "removeStitch" as const, id: s.id })) }, { label: "Delete" })}><Trash2 size={14} /> Delete</Button>
      </div>
    </aside>
  );
}

void api;
