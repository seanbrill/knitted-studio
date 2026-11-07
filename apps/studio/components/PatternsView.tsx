"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@knitted/core/client";
import { FALLBACK_SWATCH, SIZES, foldersIn, isInside, nameOf, type ActivityAction, type Pattern, type Size } from "@knitted/core";
import { Button, ConfirmDialog, ContextMenu, Dialog, EmptyState, Field, IconButton, Input, Menu, Select, Skeleton, icons, useToast, type MenuItems } from "@knitted/ui";
import { PatternThumb, thumbContext } from "./PatternThumb";
import { RenameDialog } from "./ProjectsView";
import { FolderCrumbs, FolderDialogs, FolderList, NewFolderButton, useFolders } from "./Folders";
import { timeAgo, useLive } from "@/lib/hooks";
import { ViewBar, layout, useView, type SortBy } from "./Views";
import { AskModelDialog, aboutPattern } from "./AskModel";
import { PickBox, SelectionBar, picking, useSelection } from "./Selection";

const PATTERN_SORTS: SortBy<Pattern>[] = [
  { value: "updated", label: "Last changed", key: (p) => p.updatedAt, desc: true },
  { value: "name", label: "Name, A to Z", key: (p) => p.name },
  { value: "name-desc", label: "Name, Z to A", key: (p) => p.name, desc: true },
  { value: "size", label: "Size", key: (p) => `${p.size.name} ${p.name}` },
  { value: "tall", label: "Tallest first", key: (p) => p.size.h / p.size.w, desc: true },
];

const { Plus, MoreHorizontal, Pencil, Copy, Trash2, FolderOpen, FolderInput, Sparkles } = icons;

const ACTOR_LABEL: Record<string, string> = { human: "You", fill: "You", model: "Your model", import: "Import", system: "knitted" };
// A folder is in one section: say which, as the tabs name them.
const SECTION_NAME: Record<string, string> = { patterns: "Patterns", yarn: "Yarn", parts: "Parts", swatches: "Swatch", knits: "Knits", reference: "the reference" };
const inSection = (detail: unknown) => { const s = (detail as { section?: string } | null)?.section; return s && SECTION_NAME[s] ? ` in ${SECTION_NAME[s]}` : ""; };
type Words = (subject: string | null, detail: unknown) => string;
const onShelf = (detail: unknown) => ((detail as { shelf?: string } | null)?.shelf === "reference" ? "the reference" : "Yarn");
const cutFrom = (detail: unknown) => { const f = (detail as { from?: string } | null)?.from; return f ? `, cut from ${f}` : ""; };
const synced = (detail: unknown) => {
  const d = (detail ?? {}) as { pages?: number; pictures?: number; swatch?: boolean; profile?: boolean };
  const did = [d.profile && "wrote the profile", d.swatch && "read a swatch", d.pictures && `took ${d.pictures} picture${d.pictures === 1 ? "" : "s"}`].filter(Boolean);
  return `${d.pages ? `, read ${d.pages} page${d.pages === 1 ? "" : "s"}` : ""}${did.length ? ` and ${did.join(", ")}` : ""}`;
};
// Every action the log records has words here: the type says so (ActivityAction).
const ACTION_TEXT = {
  "project.created": (s) => `created ${s}`,
  "project.renamed": (s) => `renamed the project to ${s}`,
  "project.picture": (s) => (s ? "changed the project's picture" : "took the project's picture away"),
  "project.duplicated": (s) => `duplicated ${s}`,
  "project.deleted": (s) => `deleted ${s}`,
  "pattern.created": (s) => `added the pattern ${s}`,
  "pattern.duplicated": (s) => `duplicated the pattern ${s}`,
  "pattern.deleted": (s) => `deleted the pattern ${s}`,
  "edit.refused": (s) => `tried to change locked stitches in ${s}, and was told no`,
  "yarn.imported": (s, d) => `added ${s} to ${onShelf(d)}${cutFrom(d)}`,
  "yarn.changed": (s) => `changed the saved text ${s}`,
  "yarn.deleted": (s, d) => `deleted ${s} from ${onShelf(d)}`,
  "swatch.created": (s) => `added the swatch ${s}`,
  "brief.built": (s) => `built the profile from ${s}`,
  "brief.changed": (_s, d) => ((d as { undo?: boolean } | null)?.undo ? "put back the profile from before" : "changed the profile"),
  "brief.synced": (s, d) => `synced with ${s}${synced(d)}`,
  "part.created": (s) => `added the part ${s}`,
  "folder.created": (s, d) => `made the folder ${s}${inSection(d)}`,
  "folder.filed": (s) => `filed ${s}`,
  "folder.renamed": (s, d) => `renamed the folder ${s}${inSection(d)}`,
  "folder.deleted": (s, d) => `deleted the folder ${s}${inSection(d)}, and kept what was in it`,
} satisfies Record<ActivityAction, Words>;
// A row is a string from the database: one an older version logged may have no words.
const wordsFor = (action: string): Words => (ACTION_TEXT as Record<string, Words | undefined>)[action] ?? ((s) => `${action} ${s ?? ""}`);

export function PatternsView({ projectId }: { projectId: string }) {
  const toast = useToast();
  const router = useRouter();
  const { data: patterns, refresh } = useLive(() => api.patterns.list(projectId), [projectId]);
  const { data: activity } = useLive(() => api.projects.activity(projectId), [projectId]);
  // What the cards are drawn with, as the editor has it: the project's swatch, Yarn and Parts.
  const { data: look } = useLive(async () => {
    const [project, swatches, yarn, parts] = await Promise.all([api.projects.get(projectId), api.swatches.list(projectId), api.yarn.list(projectId), api.parts.list(projectId)]);
    return { swatch: swatches.find((s) => s.id === project.swatchId) ?? swatches[0] ?? FALLBACK_SWATCH, yarn, parts };
  }, [projectId]);
  const thumbs = useMemo(() => (look ? thumbContext(projectId, look) : null), [look, projectId]);
  const kit = useFolders(projectId, "patterns", patterns, { onChanged: refresh });
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Pattern | null>(null);
  const [deleting, setDeleting] = useState<Pattern | null>(null);

  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try { await fn(); await refresh(); if (msg) toast(msg); } catch (e) { toast((e as Error).message); }
  };
  const view = useView<Pattern>("patterns", PATTERN_SORTS);
  const [q, setQ] = useState("");
  const [size, setSize] = useState("all");
  const sizes = useMemo(() => [...new Set((patterns ?? []).map((p) => p.size.name))].sort(), [patterns]);
  // A search or a size looks in the folder the person is in and every folder inside it.
  const filtering = !!q.trim() || size !== "all";
  const here = view.sorted((patterns ?? []).filter((p) => (filtering ? isInside(p.folder, kit.here) && p.name.toLowerCase().includes(q.trim().toLowerCase()) && (size === "all" || p.size.name === size) : p.folder === kit.here)));
  const sel = useSelection(here);
  const [asking, setAsking] = useState<Pattern | null>(null);
  const [bulkDelete, setBulkDelete] = useState(false);
  // A click with Shift, Ctrl or Cmd held picks the pattern instead of opening it.
  const pick = (p: Pattern) => (e: React.MouseEvent) => { if (picking(e)) { e.preventDefault(); sel.toggle(p.id, e.shiftKey); } };
  const menu = (p: Pattern): MenuItems => [
    { label: "Open in editor", icon: <FolderOpen size={14} />, onSelect: () => router.push(`/projects/${projectId}/patterns/${p.id}`) },
    { label: "Ask your model...", icon: <Sparkles size={14} />, onSelect: () => setAsking(p) },
    { label: "Rename", icon: <Pencil size={14} />, onSelect: () => setRenaming(p) },
    { label: "Duplicate", icon: <Copy size={14} />, onSelect: () => act(() => api.patterns.duplicate(p.id), "Duplicated") },
    { label: "Move to folder", icon: <FolderInput size={14} />, onSelect: () => kit.askMove([p], p.name) },
    "separator",
    { label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleting(p) },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: "var(--space-8)", alignItems: "start" }}>
      <section aria-label="Patterns">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
          <h2 className="h2">Patterns</h2>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <NewFolderButton kit={kit} />
            <Button variant="primary" tip="A layout with slots to fill, at one size. Knit it into files again and again." onClick={() => setCreating(true)}><Plus size={16} /> New pattern</Button>
          </div>
        </div>
        <FolderCrumbs kit={kit} />
        {(patterns?.length ?? 0) > 0 && (
          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
            <Input aria-label={kit.here ? `Search ${nameOf(kit.here)} and the folders in it` : "Search patterns"} placeholder="Search patterns" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
            <div style={{ minWidth: 160 }}><Select aria-label="Size" value={size} onValueChange={setSize} options={[{ value: "all", label: "Every size" }, ...sizes.map((x) => ({ value: x, label: x }))]} /></div>
            <ViewBar view={view} what="patterns" />
          </div>
        )}
        <SelectionBar sel={sel} total={here.length}>
          <Button size="sm" onClick={() => kit.askMove(sel.picked, `${sel.count} ${sel.count === 1 ? "pattern" : "patterns"}`)}><FolderInput size={13} aria-hidden /> Move to folder</Button>
          <Button size="sm" onClick={() => act(async () => { for (const p of sel.picked) await api.patterns.duplicate(p.id); }, `Duplicated ${sel.count}`)}><Copy size={13} aria-hidden /> Duplicate</Button>
          <Button size="sm" variant="danger" onClick={() => setBulkDelete(true)}><Trash2 size={13} aria-hidden /> Delete</Button>
        </SelectionBar>
        {filtering ? (kit.here && <p className="body-sm" style={{ margin: "0 0 var(--space-3)", color: "var(--ink-muted)" }}>Looking in {nameOf(kit.here)} and the folders in it.</p>) : <FolderList kit={kit} />}
        {!patterns || !kit.folders ? <Skeleton height={240} /> : patterns.length === 0 && kit.folders.length === 0 ? (
          <EmptyState title="No patterns yet" body="A pattern is a layout you set once and knit from again and again." action={<Button variant="primary" onClick={() => setCreating(true)}>New pattern</Button>} />
        ) : here.length === 0 ? (
          filtering ? <EmptyState title="Nothing matches" body="Try another search or size." /> : kit.here && !kit.gone && foldersIn(kit.folders, kit.here).length === 0 && (
            <EmptyState title={`Nothing in ${nameOf(kit.here)} yet`} body="Drag patterns onto this folder, or choose Move to folder on one. A pattern made here goes in it." action={<Button variant="primary" onClick={() => setCreating(true)}>New pattern</Button>} />
          )
        ) : (
          <div style={layout(view.mode, 190)}>
            {here.map((p) => view.mode === "list" ? (
              <ContextMenu key={p.id} items={menu(p)}>
                <div className="pickable" data-selected={sel.has(p.id)}>
                <PickBox sel={sel} id={p.id} name={p.name} className="pick-box" />
                <div className="card card-link" draggable onDragStart={kit.dragThings(sel.has(p.id) ? sel.picked.map((x) => x.id) : [p.id])} style={{ padding: "6px var(--space-3) 6px 6px", position: "relative", display: "grid", gridTemplateColumns: "56px minmax(0, 1fr) auto auto", gap: "var(--space-3)", alignItems: "center" }}>
                  <Link href={`/projects/${projectId}/patterns/${p.id}`} aria-label={`Open ${p.name}`} draggable={false} onClick={pick(p)} style={{ position: "absolute", inset: 0, zIndex: 1, borderRadius: "var(--radius-md)" }} />
                  <div className="thumb" aria-hidden style={{ width: 56, height: 56, padding: 4 }}>
                    <div style={{ width: p.size.w >= p.size.h ? "100%" : `${(p.size.w / p.size.h) * 100}%` }}><PatternThumb pattern={p} ctx={thumbs} /></div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p className="label" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</p>
                    <p className="eyebrow" style={{ margin: "2px 0 0" }}>{p.size.name} · {p.size.w}x{p.size.h}{p.durationMs ? ` · ${(p.durationMs / 1000).toFixed(1)}s` : ""}{filtering && p.folder !== kit.here ? ` · in ${p.folder.split("/").join(" / ")}` : ""}</p>
                  </div>
                  <span className="body-sm" style={{ color: "var(--ink-muted)", whiteSpace: "nowrap" }}>{timeAgo(p.updatedAt)}</span>
                  <span style={{ position: "relative", zIndex: 2 }}><Menu trigger={<IconButton label={`Actions for ${p.name}`}><MoreHorizontal size={16} /></IconButton>} items={menu(p)} /></span>
                </div>
                </div>
              </ContextMenu>
            ) : (
              <ContextMenu key={p.id} items={menu(p)}>
                <div className="pickable" data-selected={sel.has(p.id)}>
                <PickBox sel={sel} id={p.id} name={p.name} className="pick-box" />
                <div className="card card-link" draggable onDragStart={kit.dragThings(sel.has(p.id) ? sel.picked.map((x) => x.id) : [p.id])} style={{ padding: "var(--space-3)", position: "relative" }}>
                  <Link href={`/projects/${projectId}/patterns/${p.id}`} aria-label={`Open ${p.name}`} draggable={false} onClick={pick(p)} style={{ position: "absolute", inset: 0, zIndex: 1, borderRadius: "var(--radius-md)" }} />
                  <div className="thumb" style={{ aspectRatio: "4 / 5", padding: "var(--space-2)" }}>
                    <div style={{ width: "100%", maxHeight: "100%", display: "grid", placeItems: "center" }}>
                      <div style={{ width: p.size.w / p.size.h > 0.8 ? "100%" : `${(p.size.w / p.size.h / 0.8) * 100}%`, boxShadow: "0 1px 4px rgba(23,17,11,.18)" }}>
                        <PatternThumb pattern={p} ctx={thumbs} />
                      </div>
                    </div>
                  </div>
                  <p className="label" style={{ margin: "var(--space-3) 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</p>
                  <p className="eyebrow" style={{ margin: "2px 0 0" }}>{p.size.name} · {p.size.w}x{p.size.h}</p>
                  <span style={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
                    <Menu trigger={<IconButton label={`Actions for ${p.name}`}><MoreHorizontal size={16} /></IconButton>} items={menu(p)} />
                  </span>
                </div>
                </div>
              </ContextMenu>
            ))}
          </div>
        )}
      </section>

      <aside aria-label="Activity">
        <h2 className="eyebrow" style={{ marginBottom: "var(--space-3)" }}>Activity</h2>
        {!activity ? <Skeleton height={80} /> : activity.length === 0 ? <p className="body-sm" style={{ color: "var(--ink-muted)" }}>Nothing yet.</p> : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-3)" }}>
            {activity.slice(0, 12).map((a) => (
              <li key={a.id} className="body-sm">
                <strong>{ACTOR_LABEL[a.actor] ?? a.actor}</strong> {wordsFor(a.action)(a.subject, a.detail)}
                <span style={{ display: "block", color: "var(--ink-muted)" }}>{timeAgo(a.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </aside>

      <NewPatternDialog open={creating} onOpenChange={setCreating} projectId={projectId} folder={kit.here} onCreated={(p) => router.push(`/projects/${projectId}/patterns/${p.id}`)} />
      <RenameDialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)} title="Rename pattern" initial={renaming?.name ?? ""}
        onSave={(name) => act(() => api.patterns.apply(renaming!.id, { type: "setMeta", name }, { label: "Rename" }))} />
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete ${deleting?.name ?? "pattern"}?`}
        description="This removes the pattern and its history. Anything you already knitted from it stays."
        confirmLabel="Delete pattern" onConfirm={async () => { await api.patterns.remove(deleting!.id); await refresh(); toast("Pattern deleted"); }} />
      <ConfirmDialog open={bulkDelete} onOpenChange={setBulkDelete} title={`Delete ${sel.count} ${sel.count === 1 ? "pattern" : "patterns"}?`}
        description="This removes them and their history. Anything you already knitted from them stays." confirmLabel="Delete patterns"
        onConfirm={async () => { for (const p of sel.picked) await api.patterns.remove(p.id); sel.clear(); await refresh(); toast("Deleted"); }} />
      <AskModelDialog about={asking ? aboutPattern(asking) : null} onOpenChange={(o) => !o && setAsking(null)} />
      <FolderDialogs kit={kit} />
    </div>
  );
}

function NewPatternDialog({ open, onOpenChange, projectId, folder, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; folder: string; onCreated: (p: Pattern) => void }) {
  const [name, setName] = useState("");
  const [size, setSize] = useState(SIZES[0].name);
  const [err, setErr] = useState<string | undefined>();
  const submit = async () => {
    try {
      const sz: Size = SIZES.find((s) => s.name === size) ?? SIZES[0];
      const p = await api.patterns.create(projectId, { name: name || undefined, size: sz, folder });
      onOpenChange(false); setName(""); onCreated(p);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New pattern" description={`Pick a size. You can change it later.${folder ? ` It goes in ${nameOf(folder)}.` : ""}`}
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={submit}>Create pattern</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label="Name" error={err} htmlFor="npat-name"><Input id="npat-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled pattern" /></Field>
        <Field label="Size" htmlFor="npat-size">
          <Select id="npat-size" aria-label="Size" value={size} onValueChange={setSize} options={SIZES.map((s) => ({ value: s.name, label: `${s.name} (${s.w}x${s.h})` }))} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
