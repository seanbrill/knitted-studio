"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@knitted/core/client";
import { foldersIn, hasLintErrors, isInside, lintCodePart, nameOf, type Part, type PartCategory } from "@knitted/core";
import { Button, Chip, ConfirmDialog, Dialog, EmptyState, Field, Input, Select, SkeletonSection, Textarea, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { leadOf, useMarks } from "@/lib/agent";
import { ModelMark } from "./ModelMark";
import { PartThumb } from "./editor/PartThumb";
import { FolderCrumbs, FolderDialogs, FolderList, NewFolderButton, useFolders } from "./Folders";
import { ViewBar, commonSorts, layout, useView } from "./Views";

const { Plus, Upload, Download, Copy, Trash2, AlertTriangle, FolderInput, Pencil } = icons;
const CATS: { value: PartCategory; label: string }[] = [{ value: "text", label: "Text" }, { value: "media", label: "Media" }, { value: "motion", label: "Motion" }, { value: "frame", label: "Frame" }, { value: "cta", label: "Call to action" }, { value: "other", label: "Other" }];
const STARTER_HTML = `<div class="card">\n  <span class="k">{{kicker}}</span>\n  <strong>{{title}}</strong>\n</div>`;
const STARTER_CSS = `.card{position:absolute;inset:0;display:grid;align-content:center;gap:6px;padding:8%;background:#17110b;color:#fffbf6;font:700 5.5vw system-ui;border-radius:12px;animation:in 600ms ease-out both}\n.k{font:500 2.4vw ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#ff9254}\n@keyframes in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`;

export function PartsManager({ projectId }: { projectId: string }) {
  const toast = useToast();
  const router = useRouter();
  const { data: parts, refresh } = useLive(() => api.parts.list(projectId), [projectId]);
  const { data: swatches } = useLive(() => api.swatches.list(projectId), [projectId]);
  const { data: project } = useLive(() => api.projects.get(projectId), [projectId]);
  const swatch = swatches?.find((s) => s.id === project?.swatchId) ?? swatches?.[0];
  // What a model is changing or looking at, outlined on its card.
  const marks = useMarks((w) => [w.partId, ...(w.thingIds ?? [])]);
  const lead = leadOf(marks);
  const [creating, setCreating] = useState(false);
  const [coding, setCoding] = useState<Part | null>(null);
  const [del, setDel] = useState<{ part: Part; usedIn: number } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  // Folders sort the parts that are yours. The starter parts stay as they come.
  const mine = useMemo(() => (parts ?? []).filter((p) => !p.builtin), [parts]);
  const kit = useFolders(projectId, "parts", parts ? mine : null, { onChanged: refresh });
  const view = useView<Part>("parts", commonSorts<Part>());
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | PartCategory>("all");

  const act = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); await refresh(); if (msg) toast(msg); } catch (e) { toast.problem((e as Error).message); } };
  // A Part of stitches opens in the editor, where every change is the Part's. One in code opens
  // as code. A starter is never changed: a copy of it is made, in the folder the person is in.
  const edit = async (p: Part) => {
    if (p.kind === "code") { setCoding(p); return; }
    try {
      const mine = p.builtin ? await api.parts.action(p.id, "duplicate", projectId, kit.here) : p;
      if (mine.kind === "code") { setCoding(mine); return; }
      const pat = await api.parts.edit(mine.id, projectId);
      router.push(`/projects/${pat.projectId}/patterns/${pat.id}`);
    } catch (e) { toast.problem((e as Error).message); }
  };
  const download = async (p: Part) => {
    const j = await api.parts.action(p.id, "export");
    const url = URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.knitted-part.json` }).click();
    URL.revokeObjectURL(url);
  };

  if (!parts || !swatch || !kit.folders) return <SkeletonSection tiles={0} cards={6} min={240} ratio="16 / 9" list={view.mode === "list"} />;
  // A search or a kind looks in the folder the person is in and every folder inside it, and the starters too.
  const filtering = !!q.trim() || cat !== "all";
  const matches = (p: Part) => (cat === "all" || p.category === cat) && `${p.name} ${p.description}`.toLowerCase().includes(q.trim().toLowerCase());
  const here = view.sorted(mine.filter((p) => (filtering ? isInside(p.folder, kit.here) && matches(p) : p.folder === kit.here)));
  const builtin = view.sorted(parts.filter((p) => p.builtin && (!filtering || matches(p))));

  const grid = (list: Part[], editable: boolean) => (
    <ul className="arrive-list" style={layout(view.mode, 240)}>
      {list.map((p) => (
        <li key={p.id} className="card" draggable={editable} onDragStart={editable ? kit.dragThings([p.id]) : undefined}
          style={view.mode === "grid" ? { padding: "var(--space-3)", display: "grid", gap: 8, position: "relative" } : { padding: "var(--space-2) var(--space-3)", display: "grid", gridTemplateColumns: "120px minmax(0, 1fr) auto", gap: "var(--space-3)", alignItems: "center", position: "relative" }}>
          <ModelMark mark={marks.get(p.id)} lead={lead === p.id} />
          <PartThumb part={p} swatch={swatch} projectId={projectId} width={view.mode === "grid" ? 216 : 120} />
          <div style={{ minWidth: 0 }}>
            <p className="label" style={{ margin: 0 }}>{p.name}</p>
            <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{p.builtin ? "Starter" : p.projectId ? "This project" : "Library"} · {p.kind === "code" ? "code" : "stitches"} · v{p.version}</p>
            {p.slots.length > 0 && <p className="body-sm" style={{ margin: "2px 0 0" }}>{p.slots.map((s) => <Chip key={s.name} className="code">{s.name}{s.locked ? " locked" : ""}</Chip>)}</p>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button size="sm" aria-label={`${p.builtin ? "Edit a copy of" : "Edit"} ${p.name}`} tip={p.builtin ? "A starter stays as it comes: this makes a copy of your own and opens it." : p.kind === "code" ? "Its markup and CSS." : "Opens it in the editor. Every pattern that uses it shows the change."} onClick={() => edit(p)}><Pencil size={12} aria-hidden /> {p.builtin ? "Edit a copy" : "Edit"}</Button>
            {/* A starter part's copy goes in the folder the person is in; one of theirs, next to it. */}
            <Button size="sm" onClick={() => act(() => api.parts.action(p.id, "duplicate", projectId, p.builtin ? kit.here : undefined), `Duplicated ${p.name}${p.builtin && kit.here ? ` into ${nameOf(kit.here)}` : ""}`)}><Copy size={12} aria-hidden /> Duplicate</Button>
            {editable && <Button size="sm" aria-label={`Move to folder, ${p.name}`} onClick={() => kit.askMove([p], p.name)}><FolderInput size={12} aria-hidden /> Move to folder</Button>}
            <Button size="sm" onClick={() => download(p)}><Download size={12} aria-hidden /> Export</Button>
            {editable && (p.projectId
              ? <Button size="sm" onClick={() => act(() => api.parts.action(p.id, "to-library"), "Now in the library for every project")}>To library</Button>
              : <Button size="sm" onClick={() => act(() => api.parts.action(p.id, "to-project", projectId), "Moved into this project")}>To this project</Button>)}
            {editable && <Button size="sm" variant="danger" aria-label={`Delete ${p.name}`} onClick={async () => setDel({ part: p, usedIn: (await api.parts.get(p.id)).usage.length })}><Trash2 size={12} aria-hidden /></Button>}
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div style={{ display: "grid", gap: "var(--space-8)" }}>
      <section aria-label="Your parts">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
          <h2 className="h2">Your parts</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <NewFolderButton kit={kit} />
            <Button onClick={() => file.current?.click()}><Upload size={14} aria-hidden /> Import</Button>
            <input ref={file} type="file" accept=".json,application/json" hidden aria-label="Choose a part file" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) await act(async () => api.parts.import(projectId, JSON.parse(await f.text()), "project", kit.here), kit.here ? `Imported into ${nameOf(kit.here)}` : "Imported"); }} />
            <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} aria-hidden /> New code part</Button>
          </div>
        </div>
        <FolderCrumbs kit={kit} />
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
          <Input aria-label="Search parts" placeholder="Search parts" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          <div style={{ minWidth: 160 }}><Select aria-label="Kind of part" value={cat} onValueChange={(v) => setCat(v as "all" | PartCategory)} options={[{ value: "all", label: "Every kind" }, ...CATS]} /></div>
          <ViewBar view={view} what="parts" />
        </div>
        {filtering ? (kit.here && <p className="body-sm" style={{ margin: "0 0 var(--space-3)", color: "var(--ink-muted)" }}>Looking in {nameOf(kit.here)} and the folders in it.</p>) : <FolderList kit={kit} />}
        {filtering && here.length === 0 ? <p className="body-sm" style={{ color: "var(--ink-muted)" }}>None of your parts match.</p>
          : mine.length === 0 && kit.folders.length === 0 ? <EmptyState title="No parts of your own yet" body="Select stitches in the editor and choose Save as part, or write one in code here." />
          : here.length > 0 ? grid(here, true)
          : kit.here && !kit.gone && foldersIn(kit.folders, kit.here).length === 0 && <EmptyState title={`Nothing in ${nameOf(kit.here)} yet`} body="Drag parts onto this folder, or choose Move to folder on one. A part made, imported or duplicated from the starters here goes in it." />}
      </section>
      <section aria-label="Starter parts">
        <h2 className="h2" style={{ marginBottom: "var(--space-4)" }}>Starter parts</h2>
        {builtin.length ? grid(builtin, false) : <p className="body-sm" style={{ color: "var(--ink-muted)" }}>No starter parts match.</p>}
      </section>
      <CodePartDialog open={creating} onOpenChange={setCreating} projectId={projectId} folder={kit.here} swatch={swatch} onDone={refresh} />
      {coding && <CodePartDialog key={coding.id} part={coding} open onOpenChange={(o) => !o && setCoding(null)} projectId={projectId} folder={coding.folder} swatch={swatch} onDone={() => { void refresh(); toast(`Saved ${coding.name}. Every pattern that uses it shows the change.`); }} />}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Delete ${del?.part.name ?? "part"}?`}
        description={del?.usedIn ? `It is used in ${del.usedIn} ${del.usedIn === 1 ? "pattern" : "patterns"}. Those will show a missing-part gap until you replace it.` : "Nothing uses it."} confirmLabel="Delete part"
        onConfirm={async () => { await api.parts.remove(del!.part.id); await refresh(); toast("Deleted"); }} />
      <FolderDialogs kit={kit} />
    </div>
  );
}

/** A Part written in code: a new one, or `part` to change. A slot kept by name keeps its default and its lock. */
function CodePartDialog({ part, open, onOpenChange, projectId, folder, swatch, onDone }: { part?: Part; open: boolean; onOpenChange: (o: boolean) => void; projectId: string; folder: string; swatch: Parameters<typeof PartThumb>[0]["swatch"]; onDone: () => void }) {
  const [name, setName] = useState(part?.name ?? ""); const [category, setCategory] = useState<PartCategory>(part?.category ?? "motion");
  const [html, setHtml] = useState(part?.html ?? STARTER_HTML); const [css, setCss] = useState(part?.css ?? STARTER_CSS);
  const [slotText, setSlotText] = useState(part ? part.slots.map((s) => s.name).join(", ") : "kicker, title"); const [aspect, setAspect] = useState(String(part ? +part.aspect.toFixed(3) : 2)); const [err, setErr] = useState<string | undefined>();
  const lint = useMemo(() => lintCodePart(html, css), [html, css]);
  const slots = slotText.split(",").map((s) => s.trim()).filter(Boolean).map((n) => part?.slots.find((s) => s.name === n) ?? ({ name: n, kind: "text" as const, locked: false, default: n === "title" ? "Make it knitted" : n === "kicker" ? "New this week" : "" }));
  const draft = { id: "draft", projectId, builtin: false, name: name || "Draft", description: "", category, tags: [], kind: "code" as const, stitches: [], html, css, slots, aspect: Number(aspect) || 2, durationMs: 0, version: 1, folder, createdAt: "", updatedAt: "" };
  const save = async () => {
    try {
      const b = { name, category, kind: "code", html, css, slots, aspect: Number(aspect) || 2 };
      if (part) await api.parts.update(part.id, b); else await api.parts.create(projectId, { ...b, folder });
      onOpenChange(false); if (!part) setName(""); setErr(undefined); onDone();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title={part ? `Edit ${part.name}` : "New code part"} description={`Markup and CSS in a sandbox: no scripts, no network. Use {{slot}} where a value goes. Animate with CSS, which the engine drives frame by frame.${part ? " Every pattern that uses it shows the change." : ""}`}
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={hasLintErrors(lint) || !name.trim()} onClick={save}>Save part</Button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: "var(--space-5)" }}>
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Name" error={err} htmlFor="cp-name"><Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Slide-in card" /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 90px", gap: 10 }}>
            <Field label="Kind of part"><Select aria-label="Kind of part" value={category} onValueChange={(v) => setCategory(v as PartCategory)} options={CATS} /></Field>
            <Field label="Slots (comma separated)" htmlFor="cp-slots"><Input id="cp-slots" mono value={slotText} onChange={(e) => setSlotText(e.target.value)} /></Field>
            <Field label="Shape" htmlFor="cp-aspect" hint="width / height"><Input id="cp-aspect" mono value={aspect} onChange={(e) => setAspect(e.target.value)} /></Field>
          </div>
          <Field label="Markup" htmlFor="cp-html"><Textarea id="cp-html" rows={5} value={html} onChange={(e) => setHtml(e.target.value)} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }} /></Field>
          <Field label="CSS" htmlFor="cp-css"><Textarea id="cp-css" rows={7} value={css} onChange={(e) => setCss(e.target.value)} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }} /></Field>
          <ul aria-label="Checks" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
            {lint.length === 0 && <li className="body-sm" style={{ color: "var(--success)" }}>No problems. Safe, offline and reproducible.</li>}
            {lint.map((l, i) => <li key={i} className="body-sm" style={{ color: l.level === "error" ? "var(--danger)" : "var(--ink)", display: "flex", gap: 6 }}><AlertTriangle size={13} aria-hidden style={{ marginTop: 2, flexShrink: 0 }} /><span><strong>{l.level === "error" ? "Fix: " : "Heads up: "}</strong>{l.message}</span></li>)}
          </ul>
        </div>
        <div><p className="eyebrow" style={{ marginBottom: 6 }}>Preview</p><PartThumb part={draft} swatch={swatch} projectId={projectId} width={240} /></div>
      </div>
    </Dialog>
  );
}
