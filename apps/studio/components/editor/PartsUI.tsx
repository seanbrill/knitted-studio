"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@knitted/core/client";
import { instanceOf, isInside, partFromStitches, uniqueSlotName, detachInstance, type Part, type PartCategory, type PartSlot, type Stitch } from "@knitted/core";
import { Button, Chip, Dialog, EmptyState, Field, Input, Select, Switch, icons, useToast } from "@knitted/ui";
import { useEditor } from "@/lib/editor/store";
import { byFolder, FolderCrumbs, InFolder, useFolders } from "../Folders";
import { PanelFolders } from "./Panels";
import { PartThumb } from "./PartThumb";

const { Search, Package } = icons;
const rid = () => `st_${Math.random().toString(36).slice(2, 9)}`;
const CATS: { value: PartCategory; label: string }[] = [{ value: "text", label: "Text" }, { value: "media", label: "Media" }, { value: "motion", label: "Motion" }, { value: "frame", label: "Frame" }, { value: "cta", label: "Call to action" }, { value: "other", label: "Other" }];

/** Drop a Part into the pattern, centred, as a named instance. */
export function insertPart(part: Part) {
  const st = useEditor.getState();
  const W = st.pattern.size.w, H = st.pattern.size.h;
  const w = Math.min(0.84, part.aspect >= 1 ? 0.6 : 0.4), h = (w * W) / part.aspect / H;
  const slot = uniqueSlotName(part.name, st.pattern.stitches.map((s) => s.slot));
  const inst = instanceOf(part, { x: (1 - w) / 2, y: Math.min(0.9 - h, 0.45), w, h }, slot);
  st.dispatch({ type: "addStitch", stitch: inst }, { label: `Add ${part.name}` });
  st.select([inst.id]);
}

export function PartsPanel({ projectId, onPartsChanged }: { projectId: string; onPartsChanged: () => void }) {
  const { parts, swatch } = useEditor();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"all" | "mine" | "library">("all");
  const mine = useMemo(() => Object.values(parts).filter((p) => !p.builtin), [parts]);
  const kit = useFolders(projectId, "parts", mine, { inAddress: false, onChanged: onPartsChanged });
  // A search looks in this folder and the folders in it. The starter parts are at the top.
  const filtering = !!q.trim();
  const list = useMemo(() => Object.values(parts)
    .filter((p) => (p.builtin ? !kit.here : filtering ? isInside(p.folder, kit.here) : p.folder === kit.here))
    .filter((p) => (scope === "all" || (scope === "mine" ? !!p.projectId : !p.projectId)) && p.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(a.builtin) - Number(b.builtin) || a.name.localeCompare(b.name)), [parts, q, scope, filtering, kit.here]);
  return (
    <div>
      <h2 className="eyebrow" style={{ margin: "0 0 var(--space-3)" }}>Parts</h2>
      <div style={{ position: "relative", marginBottom: 8 }}>
        <Search size={14} aria-hidden style={{ position: "absolute", left: 9, top: 10, color: "var(--ink-muted)" }} />
        <Input aria-label="Search parts" placeholder="Search parts" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 30 }} />
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }} role="group" aria-label="Show">
        {(["all", "mine", "library"] as const).map((s) => <button key={s} type="button" className="chip chip-button" aria-pressed={scope === s} onClick={() => setScope(s)}>{s === "all" ? "All" : s === "mine" ? "This project" : "Library"}</button>)}
      </div>
      {filtering ? <FolderCrumbs kit={kit} /> : <PanelFolders kit={kit} empty={list.length === 0} />}
      {list.length === 0 ? ((filtering || !kit.here) && <EmptyState title="No parts match" body="Select some stitches and choose Save as part to make your own." />) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {list.map((p) => {
            const from = !p.builtin && p.folder !== kit.here ? p.folder : "";
            return (
            <li key={p.id}>
              <div className="card card-link" draggable={!p.builtin} onDragStart={p.builtin ? undefined : kit.dragThings([p.id])} style={{ position: "relative", padding: 8 }}>
                {/* One empty button carries the name, so what is announced and what is shown cannot disagree. */}
                <button aria-label={`Add ${p.name}${from ? `, from ${from.split("/").join(" / ")}` : ""}`} onClick={() => insertPart(p)} style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent", border: 0, cursor: "pointer", borderRadius: "var(--radius-md)" }} />
                <PartThumb part={p} swatch={swatch} projectId={projectId} width={208} />
                <span className="label" aria-hidden style={{ display: "block", marginTop: 6 }}>{p.name}</span>
                <span className="body-sm" aria-hidden style={{ color: "var(--ink-muted)" }}>{p.builtin ? "Starter" : p.projectId ? "This project" : "Library"}{p.kind === "code" ? " · code" : ""}</span>
                {from && <span aria-hidden style={{ display: "block", marginTop: 2 }}><InFolder path={from} /></span>}
              </div>
            </li>
            );
          })}
        </ul>
      )}
      <p className="body-sm" style={{ color: "var(--ink-muted)", marginTop: 12 }}>Linked parts follow the part. Detach one to edit it freely. <Link className="link" href={`/projects/${projectId}/parts`}>Manage parts</Link></p>
    </div>
  );
}

/** "Save as part": choose a name, say which slots are the brand's to lock, and swap the selection for a linked instance. */
export function SavePartDialog({ open, onOpenChange, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string }) {
  const st = useEditor();
  const toast = useToast();
  const sel = st.pattern.stitches.filter((s) => st.selection.includes(s.id));
  const [name, setName] = useState("");
  const [category, setCategory] = useState<PartCategory>("other");
  const [library, setLibrary] = useState(false);
  const [locked, setLocked] = useState<string[]>([]);
  const [err, setErr] = useState<string | undefined>();
  const slots = sel.filter((s) => s.slot && (s.kind === "text" || s.kind === "image")).map((s) => s.slot!);
  const save = async () => {
    try {
      const { draft, box } = partFromStitches(sel, st.pattern.size, { name, category, lockedSlots: locked });
      const part = await api.parts.create(projectId, { ...draft, scope: library ? "library" : "project" });
      st.setParts([...Object.values(useEditor.getState().parts), part]);
      const inst = instanceOf(part, box, uniqueSlotName(name, st.pattern.stitches.filter((s) => !st.selection.includes(s.id)).map((s) => s.slot)));
      st.dispatch({ type: "batch", commands: [...sel.map((s) => ({ type: "removeStitch" as const, id: s.id })), { type: "addStitch" as const, stitch: inst }] }, { label: `Save ${name} as a part` });
      st.select([inst.id]);
      onOpenChange(false); setName(""); setErr(undefined);
      toast(`Saved ${part.name}. It is in your Parts panel now.`);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Save as part" description={`Turn the ${sel.length} selected ${sel.length === 1 ? "stitch" : "stitches"} into something you can reuse.`}
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={!sel.length} onClick={save}>Save part</Button></>}>
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label="Name" error={err} htmlFor="sp-name"><Input id="sp-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Lower third" /></Field>
        <Field label="Kind of part"><Select aria-label="Kind of part" value={category} onValueChange={(v) => setCategory(v as PartCategory)} options={CATS} /></Field>
        {slots.length > 0 && (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label" style={{ marginBottom: 6 }}>Slots people can fill</legend>
            {slots.map((s) => (
              <label key={s} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                <span className="body-sm"><span className="code">{s}</span> {locked.includes(s) ? "is locked: the brand decides" : "is free to fill"}</span>
                <Switch label={`Lock ${s}`} checked={locked.includes(s)} onCheckedChange={(c) => setLocked((cur) => (c ? [...cur, s] : cur.filter((x) => x !== s)))} />
              </label>
            ))}
          </fieldset>
        )}
        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="body-sm">Keep it in the library<br /><span style={{ color: "var(--ink-muted)" }}>Every project can use it.</span></span><Switch label="Keep in the library" checked={library} onCheckedChange={setLibrary} /></label>
      </div>
    </Dialog>
  );
}

/** The inspector for a Part instance: its slots as fields, detach, and "this part has changed". */
export function PartInstanceInspector({ stitch }: { stitch: Stitch }) {
  const st = useEditor();
  const part = stitch.partId ? st.parts[stitch.partId] : undefined;
  const yarn = Object.values(st.yarn).filter((y) => y.kind === "image");
  const set = (slot: string, value: string) => st.dispatch({ type: "fillSlot", slot: `${stitch.slot}.${slot}`, content: value }, { label: `Fill ${slot}` });
  if (!part) return <p className="field-error">This part was deleted. Detach it or remove it.</p>;
  const outdated = (stitch.partVersion ?? part.version) < part.version;
  const detach = () => {
    const kids = detachInstance(stitch, part);
    st.dispatch({ type: "batch", commands: [{ type: "removeStitch", id: stitch.id }, ...kids.map((k) => ({ type: "addStitch" as const, stitch: { ...k, id: rid() } }))] }, { label: "Detach part" });
    st.select(kids.map((k) => k.id));
  };
  const slotDefs: PartSlot[] = part.slots;
  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <p className="body-sm" style={{ margin: 0 }}><Package size={13} aria-hidden /> Linked to <strong>{part.name}</strong>, version {part.version}.</p>
      {outdated && (
        <div className="panel" style={{ padding: 10 }} role="status">
          <p className="body-sm" style={{ margin: "0 0 6px" }}>This part has changed since you added it. It is already showing the new look.</p>
          <Button size="sm" onClick={() => st.dispatch({ type: "updateStitch", id: stitch.id, patch: { partVersion: part.version, partSlots: part.slots } }, { label: "Accept part update" })}>Accept the update</Button>
        </div>
      )}
      {slotDefs.map((sl) => (
        <Field key={sl.name} label={`${sl.name}${sl.locked ? " (locked)" : ""}`} htmlFor={`pi-${sl.name}`}>
          {sl.kind === "text" ? (
            <Input id={`pi-${sl.name}`} defaultValue={stitch.overrides?.[sl.name] ?? sl.default ?? ""} key={`${stitch.id}-${sl.name}-${stitch.overrides?.[sl.name]}`} disabled={sl.locked && st.mode === "fill"} onBlur={(e) => e.target.value !== (stitch.overrides?.[sl.name] ?? sl.default ?? "") && set(sl.name, e.target.value)} />
          ) : (
            <Select aria-label={sl.name} value={stitch.overrides?.[sl.name] ?? ""} onValueChange={(v) => set(sl.name, v)} options={byFolder(yarn, (y) => ({ value: y.id, label: y.name }))} placeholder="Choose from Yarn" />
          )}
        </Field>
      ))}
      <Button onClick={detach}>Detach to edit freely</Button>
    </div>
  );
}

void Chip;
