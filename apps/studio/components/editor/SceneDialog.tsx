"use client";

import { useState } from "react";
import { PRESETS, sceneChange, shownOf, type Command, type Preset, type Stitch } from "@knitted/core";
import { Button, Dialog, Field, Select } from "@knitted/ui";
import { useEditor } from "@/lib/editor/store";

const label = (s: Stitch) => s.slot ?? (s.kind === "text" ? `"${(s.content ?? "").replace(/\*/g, "").slice(0, 24)}"` : s.kind);
const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const OUTS = PRESETS.filter((p) => p.kind === "out").map((p) => ({ value: p.id, label: p.label }));
const INS = PRESETS.filter((p) => p.kind === "in").map((p) => ({ value: p.id, label: p.label }));

/**
 * One scene giving way to the next, at the playhead: what is on screen goes out, a little apart,
 * all gone by then; what comes next comes in from then. Without it, scenes were only ever
 * covered by the next one, with their words still there underneath.
 */
export function SceneDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const st = useEditor();
  const { pattern } = st;
  const at = Math.round(st.playhead / 10) * 10;
  const dur = pattern.durationMs;
  const shown = (s: Stitch) => shownOf(s.id, pattern.motion, dur);
  const visible = pattern.stitches.filter((s) => !s.style?.hidden);
  // What is there now, and what comes in from now. A backdrop (most of the frame) and anything
  // locked by the brand stay unless ticked: a logo usually stays through every scene.
  const onNow = visible.filter((s) => shown(s).from < at && shown(s).goneAt > at);
  const later = visible.filter((s) => shown(s).from >= at - 100);
  const keep = (s: Stitch) => s.locked || s.w * s.h >= 0.8;
  const [leaving, setLeaving] = useState(() => new Set(onNow.filter((s) => !keep(s)).map((s) => s.id)));
  const [entering, setEntering] = useState(() => new Set(later.filter((s) => shown(s).from <= at + 2000).map((s) => s.id)));
  const [out, setOut] = useState<Preset>("fade-out");
  const [inn, setIn] = useState<Preset>("fade-in");
  const toggle = (set: Set<string>, put: (s: Set<string>) => void, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); put(n); };

  const apply = () => {
    const tracks = sceneChange(pattern, { atMs: at, leaving: [...leaving], entering: [...entering], out, in: inn });
    const end = Math.max(0, ...tracks.flatMap((t) => t.clips.map((c) => c.endMs)));
    const cmds: Command[] = tracks.map((t) => ({ type: "setMotion", stitchId: t.stitchId, clips: t.clips }));
    if (end + 500 > dur) cmds.push({ type: "setMeta", durationMs: end + 800 });
    st.dispatch({ type: "batch", commands: cmds }, { label: "Change scene" });
    onOpenChange(false);
  };

  const list = (name: string, items: Stitch[], set: Set<string>, put: (s: Set<string>) => void, when: (s: Stitch) => string) => (
    <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend className="label" style={{ marginBottom: 6 }}>{name}</legend>
      {items.length === 0 ? <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Nothing.</p> : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4, maxHeight: 220, overflow: "auto" }}>
          {items.map((s) => (
            <li key={s.id}>
              <label className="body-sm" style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={set.has(s.id)} onChange={() => toggle(set, put, s.id)} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(s)}</span>
                <span className="eyebrow">{when(s)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title={`Change scene at ${fmt(at)}`}
      description="What leaves goes out a little apart, all gone by then. What comes next comes in from then, top to bottom."
      actions={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={!leaving.size && !entering.size} onClick={apply}>Change scene</Button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-5)" }}>
        <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
          {list("Leaves", onNow, leaving, setLeaving, (s) => `since ${fmt(shown(s).from)}`)}
          <Field label="How it leaves"><Select aria-label="How it leaves" value={out} onValueChange={(v) => setOut(v as Preset)} options={OUTS} /></Field>
        </div>
        <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
          {list("Comes in", later, entering, setEntering, (s) => (shown(s).from > 0 || pattern.motion?.tracks[s.id]?.length ? `at ${fmt(shown(s).from)} now` : "there all along"))}
          <Field label="How it comes in"><Select aria-label="How it comes in" value={inn} onValueChange={(v) => setIn(v as Preset)} options={INS} /></Field>
        </div>
      </div>
    </Dialog>
  );
}
