"use client";

import { useMemo, useRef, useState } from "react";
import { api } from "@knitted/core/client";
import { hasLintErrors, lintCodePart, type Part, type PartCategory } from "@knitted/core";
import { Button, Chip, ConfirmDialog, Dialog, EmptyState, Field, Input, Select, Skeleton, Textarea, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { PartThumb } from "./editor/PartThumb";

const { Plus, Upload, Download, Copy, Trash2, AlertTriangle } = icons;
const CATS: { value: PartCategory; label: string }[] = [{ value: "text", label: "Text" }, { value: "media", label: "Media" }, { value: "motion", label: "Motion" }, { value: "frame", label: "Frame" }, { value: "cta", label: "Call to action" }, { value: "other", label: "Other" }];
const STARTER_HTML = `<div class="card">\n  <span class="k">{{kicker}}</span>\n  <strong>{{title}}</strong>\n</div>`;
const STARTER_CSS = `.card{position:absolute;inset:0;display:grid;align-content:center;gap:6px;padding:8%;background:#17110b;color:#fffbf6;font:700 5.5vw system-ui;border-radius:12px;animation:in 600ms ease-out both}\n.k{font:500 2.4vw ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#ff9254}\n@keyframes in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`;

export function PartsManager({ projectId }: { projectId: string }) {
  const toast = useToast();
  const { data: parts, refresh } = useLive(() => api.parts.list(projectId), [projectId]);
  const { data: swatches } = useLive(() => api.swatches.list(projectId), [projectId]);
  const { data: project } = useLive(() => api.projects.get(projectId), [projectId]);
  const swatch = swatches?.find((s) => s.id === project?.swatchId) ?? swatches?.[0];
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<{ part: Part; usedIn: number } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const act = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); await refresh(); if (msg) toast(msg); } catch (e) { toast((e as Error).message); } };
  const download = async (p: Part) => {
    const j = await api.parts.action(p.id, "export");
    const url = URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.knitted-part.json` }).click();
    URL.revokeObjectURL(url);
  };

  if (!parts || !swatch) return <Skeleton height={300} />;
  const mine = parts.filter((p) => !p.builtin);
  const builtin = parts.filter((p) => p.builtin);

  const grid = (list: Part[], editable: boolean) => (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
      {list.map((p) => (
        <li key={p.id} className="card" style={{ padding: "var(--space-3)", display: "grid", gap: 8 }}>
          <PartThumb part={p} swatch={swatch} projectId={projectId} width={216} />
          <div>
            <p className="label" style={{ margin: 0 }}>{p.name}</p>
            <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{p.builtin ? "Starter" : p.projectId ? "This project" : "Library"} · {p.kind === "code" ? "code" : "stitches"} · v{p.version}</p>
            {p.slots.length > 0 && <p className="body-sm" style={{ margin: "2px 0 0" }}>{p.slots.map((s) => <Chip key={s.name} className="code">{s.name}{s.locked ? " locked" : ""}</Chip>)}</p>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button size="sm" onClick={() => act(() => api.parts.action(p.id, "duplicate", projectId), `Duplicated ${p.name}`)}><Copy size={12} aria-hidden /> Duplicate</Button>
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
          <h2 className="h2">Your parts</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={() => file.current?.click()}><Upload size={14} aria-hidden /> Import</Button>
            <input ref={file} type="file" accept=".json,application/json" hidden aria-label="Choose a part file" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) await act(async () => api.parts.import(projectId, JSON.parse(await f.text())), "Imported"); }} />
            <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} aria-hidden /> New code part</Button>
          </div>
        </div>
        {mine.length === 0 ? <EmptyState title="No parts of your own yet" body="Select stitches in the editor and choose Save as part, or write one in code here." /> : grid(mine, true)}
      </section>
      <section aria-label="Starter parts">
        <h2 className="h2" style={{ marginBottom: "var(--space-4)" }}>Starter parts</h2>
        {grid(builtin, false)}
      </section>
      <CodePartDialog open={creating} onOpenChange={setCreating} projectId={projectId} swatch={swatch} onDone={refresh} />
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Delete ${del?.part.name ?? "part"}?`}
        description={del?.usedIn ? `It is used in ${del.usedIn} ${del.usedIn === 1 ? "pattern" : "patterns"}. Those will show a missing-part gap until you replace it.` : "Nothing uses it."} confirmLabel="Delete part"
        onConfirm={async () => { await api.parts.remove(del!.part.id); await refresh(); toast("Deleted"); }} />
    </div>
  );
}

function CodePartDialog({ open, onOpenChange, projectId, swatch, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; swatch: Parameters<typeof PartThumb>[0]["swatch"]; onDone: () => void }) {
  const [name, setName] = useState(""); const [category, setCategory] = useState<PartCategory>("motion");
  const [html, setHtml] = useState(STARTER_HTML); const [css, setCss] = useState(STARTER_CSS);
  const [slotText, setSlotText] = useState("kicker, title"); const [aspect, setAspect] = useState("2"); const [err, setErr] = useState<string | undefined>();
  const lint = useMemo(() => lintCodePart(html, css), [html, css]);
  const slots = slotText.split(",").map((s) => s.trim()).filter(Boolean).map((n) => ({ name: n, kind: "text" as const, locked: false, default: n === "title" ? "Make it knitted" : n === "kicker" ? "New this week" : "" }));
  const draft = { id: "draft", projectId, builtin: false, name: name || "Draft", description: "", category, tags: [], kind: "code" as const, stitches: [], html, css, slots, aspect: Number(aspect) || 2, durationMs: 0, version: 1, createdAt: "", updatedAt: "" };
  const save = async () => { try { await api.parts.create(projectId, { name, category, kind: "code", html, css, slots, aspect: Number(aspect) || 2 }); onOpenChange(false); setName(""); setErr(undefined); onDone(); } catch (e) { setErr((e as Error).message); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="New code part" description="Markup and CSS in a sandbox: no scripts, no network. Use {{slot}} where a value goes. Animate with CSS, which the engine drives frame by frame."
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
