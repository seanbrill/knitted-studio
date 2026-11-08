"use client";

// A project's design sheets: each a whole site on one board, in labelled sections. Start one
// from the brand or blank, or ask the model to design one.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@knitted/core/client";
import type { Design, Swatch } from "@knitted/core";
import { Button, Dialog, EmptyState, Field, IconButton, Input, Menu, Skeleton, useToast, icons } from "@knitted/ui";
import { timeAgo, useLive } from "@/lib/hooks";
import { leadOf, useMarks } from "@/lib/agent";
import { ModelMark } from "./ModelMark";
import { frameDoc } from "@/lib/design";
import { AskModelButton, aboutDesign } from "./AskModel";

const { Plus, MoreHorizontal, Copy, Trash2, Download } = icons;
const START = [
  { value: "brand", label: "From your brand", what: "Foundations, Components and Pages, drawn with your Swatch: a home page on a computer and a phone, to change into yours." },
  { value: "blank", label: "Blank", what: "One empty section, for you or your model to fill." },
] as const;

export const counts = (d: Design) => {
  const frames = d.sections.reduce((n, s) => n + s.frames.length, 0);
  return `${d.sections.length} section${d.sections.length === 1 ? "" : "s"}, ${frames} frame${frames === 1 ? "" : "s"}`;
};

export function DesignsView({ projectId }: { projectId: string }) {
  const toast = useToast();
  const { data: designs, refresh } = useLive(() => api.designs.list(projectId), [projectId]);
  const { data: swatches } = useLive(() => api.swatches.list(projectId), [projectId]);
  const { data: project } = useLive(() => api.projects.get(projectId), [projectId]);
  const swatch = swatches?.find((s) => s.id === project?.swatchId) ?? swatches?.[0];
  // What a model is changing or looking at, outlined on its card.
  const marks = useMarks((w) => w.designId);
  const lead = leadOf(marks);
  const [creating, setCreating] = useState(false);

  const act = async (fn: () => Promise<unknown>, msg?: string, undo?: () => Promise<unknown>) => {
    try { await fn(); await refresh(); if (msg) toast(msg, undo ? { label: "Undo", onClick: () => void undo().then(refresh) } : undefined); } catch (e) { toast((e as Error).message); }
  };

  return (
    <section aria-labelledby="designs-h">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        <h2 id="designs-h" className="h2" style={{ margin: 0, flex: 1 }}>Designs</h2>
        <AskModelButton about={aboutDesign(projectId)} />
        <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} aria-hidden /> New design</Button>
      </div>
      {!designs || !swatch ? <Skeleton height={240} />
        : !designs.length ? <EmptyState title="No designs yet" body="A design sheet is a whole site on one board, like a Figma file: its colours and type, the pieces every page shares, and each page on a computer and a phone, in labelled sections. Start one from your brand, or ask your model to design one." action={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} aria-hidden /> New design</Button>} />
        : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "var(--space-4)" }}>
            {designs.map((d) => (
              <li key={d.id} className="card card-link" style={{ padding: "var(--space-3)", position: "relative" }}>
                <Link href={`/projects/${projectId}/designs/${d.id}`} aria-label={`Open ${d.name}`} style={{ position: "absolute", inset: 0, zIndex: 1, borderRadius: "var(--radius-md)" }} />
                <ModelMark mark={marks.get(d.id)} lead={lead === d.id} />
                <Preview design={d} swatch={swatch} projectId={projectId} />
                <p className="label" style={{ margin: "var(--space-3) 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</p>
                <p className="body-sm" style={{ margin: "2px 0 0", color: "var(--ink-muted)" }}>{counts(d)}, changed {timeAgo(d.updatedAt)}</p>
                <span style={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
                  <Menu trigger={<IconButton label={`Actions for ${d.name}`}><MoreHorizontal size={16} /></IconButton>} items={[
                    { label: "Make a copy", icon: <Copy size={14} />, onSelect: () => void act(() => api.designs.duplicate(d.id), `Copied ${d.name}`) },
                    { label: "Download the code", icon: <Download size={14} />, onSelect: () => { window.location.href = api.designs.codeUrl(d.id); } },
                    { label: "Download everything, with a style guide", icon: <Download size={14} />, onSelect: () => { window.location.href = api.designs.bundleUrl(d.id); } },
                    { label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => void act(() => api.designs.remove(d.id), `Deleted ${d.name}`, () => api.designs.restore(d.id)) },
                  ]} />
                </span>
              </li>
            ))}
          </ul>
        )}
      <NewDesign projectId={projectId} open={creating} onOpenChange={setCreating} />
    </section>
  );
}

/** The first page of the sheet, small: a picture of what it is. */
function Preview({ design, swatch, projectId }: { design: Design; swatch: Swatch; projectId: string }) {
  const all = design.sections.flatMap((s) => s.frames);
  const f = all.find((x) => /home|landing|page/i.test(x.name) && x.width >= 1000) ?? all.find((x) => x.width >= 1000) ?? all[0];
  const [w, setW] = useState(0);
  return (
    <div className="design-card-preview" ref={(el) => { if (el && el.clientWidth !== w) setW(el.clientWidth); }}>
      {f && w > 0 && <iframe title={`${f.name}, a preview`} aria-hidden tabIndex={-1} inert sandbox="allow-same-origin" srcDoc={frameDoc({ ...f, height: f.height ?? Math.round(f.width * 0.625) }, swatch, projectId)}
        style={{ width: f.width, height: f.height ?? Math.round(f.width * 0.625), transform: `scale(${w / f.width})` }} />}
    </div>
  );
}

function NewDesign({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [name, setName] = useState("Website");
  const [start, setStart] = useState<"brand" | "blank">("brand");
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const d = await api.designs.create(projectId, { name: name.trim() || "Website", start });
      router.push(`/projects/${projectId}/designs/${d.id}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setErr(undefined); setBusy(false); } }} title="New design" description="A whole site on one board, in your brand."
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={make}>{busy ? "Starting..." : "Start it"}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void make(); }} style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label="Name" htmlFor="design-name" error={err}><Input id="design-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: "var(--space-2)" }}>
          <legend className="field-label" style={{ marginBottom: "var(--space-2)" }}>Start</legend>
          {START.map((s) => (
            <label key={s.value} className="card" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--space-3)", padding: "var(--space-3)", cursor: "pointer", borderColor: start === s.value ? "var(--ember)" : undefined }}>
              <input type="radio" name="design-start" value={s.value} checked={start === s.value} onChange={() => setStart(s.value)} />
              <span><span className="label" style={{ display: "block" }}>{s.label}</span><span className="body-sm" style={{ color: "var(--ink-muted)" }}>{s.what}</span></span>
            </label>
          ))}
        </fieldset>
      </form>
    </Dialog>
  );
}
