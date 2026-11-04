"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@knitted/core/client";
import { SIZES, foldersIn, nameOf, type Pattern, type Size } from "@knitted/core";
import { Button, ConfirmDialog, ContextMenu, Dialog, EmptyState, Field, IconButton, Input, Menu, Select, Skeleton, icons, useToast, type MenuItems } from "@knitted/ui";
import { PatternPreview } from "./PatternPreview";
import { RenameDialog } from "./ProjectsView";
import { FolderCrumbs, FolderDialogs, FolderList, NewFolderButton, useFolders } from "./Folders";
import { timeAgo, useLive } from "@/lib/hooks";

const { Plus, MoreHorizontal, Pencil, Copy, Trash2, FolderOpen, FolderInput } = icons;

const ACTOR_LABEL: Record<string, string> = { human: "You", fill: "You", model: "Your model", import: "Import", system: "knitted" };
// A folder is in one section: say which, as the tabs name them.
const SECTION_NAME: Record<string, string> = { patterns: "Patterns", yarn: "Yarn", parts: "Parts", swatches: "Swatch", knits: "Knits" };
const inSection = (detail: unknown) => { const s = (detail as { section?: string } | null)?.section; return s && SECTION_NAME[s] ? ` in ${SECTION_NAME[s]}` : ""; };
const ACTION_TEXT: Record<string, (subject: string | null, detail: unknown) => string> = {
  "project.created": (s) => `created ${s}`,
  "project.renamed": (s) => `renamed the project to ${s}`,
  "project.picture": (s) => (s ? "changed the project's picture" : "took the project's picture away"),
  "project.duplicated": (s) => `duplicated ${s}`,
  "project.deleted": (s) => `deleted ${s}`,
  "pattern.created": (s) => `added the pattern ${s}`,
  "pattern.duplicated": (s) => `duplicated the pattern ${s}`,
  "pattern.deleted": (s) => `deleted the pattern ${s}`,
  "edit.refused": (s) => `tried to change locked stitches in ${s}, and was told no`,
  "yarn.imported": (s) => `added ${s} to Yarn`,
  "folder.created": (s, d) => `made the folder ${s}${inSection(d)}`,
  "folder.filed": (s) => `filed ${s}`,
  "folder.renamed": (s, d) => `renamed the folder ${s}${inSection(d)}`,
  "folder.deleted": (s, d) => `deleted the folder ${s}${inSection(d)}, and kept what was in it`,
};

export function PatternsView({ projectId }: { projectId: string }) {
  const toast = useToast();
  const router = useRouter();
  const { data: patterns, refresh } = useLive(() => api.patterns.list(projectId), [projectId]);
  const { data: activity } = useLive(() => api.projects.activity(projectId), [projectId]);
  const kit = useFolders(projectId, "patterns", patterns, { onChanged: refresh });
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Pattern | null>(null);
  const [deleting, setDeleting] = useState<Pattern | null>(null);

  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try { await fn(); await refresh(); if (msg) toast(msg); } catch (e) { toast((e as Error).message); }
  };
  const here = (patterns ?? []).filter((p) => p.folder === kit.here);
  const menu = (p: Pattern): MenuItems => [
    { label: "Open in editor", icon: <FolderOpen size={14} />, onSelect: () => router.push(`/projects/${projectId}/patterns/${p.id}`) },
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
            <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> New pattern</Button>
          </div>
        </div>
        <FolderCrumbs kit={kit} />
        <FolderList kit={kit} />
        {!patterns || !kit.folders ? <Skeleton height={240} /> : patterns.length === 0 && kit.folders.length === 0 ? (
          <EmptyState title="No patterns yet" body="A pattern is a layout you set once and knit from again and again." action={<Button variant="primary" onClick={() => setCreating(true)}>New pattern</Button>} />
        ) : here.length === 0 ? (
          kit.here && !kit.gone && foldersIn(kit.folders, kit.here).length === 0 && (
            <EmptyState title={`Nothing in ${nameOf(kit.here)} yet`} body="Drag patterns onto this folder, or choose Move to folder on one. A pattern made here goes in it." action={<Button variant="primary" onClick={() => setCreating(true)}>New pattern</Button>} />
          )
        ) : (
          <div style={{ display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
            {here.map((p) => (
              <ContextMenu key={p.id} items={menu(p)}>
                <div className="card card-link" draggable onDragStart={kit.dragThings([p.id])} style={{ padding: "var(--space-3)", position: "relative" }}>
                  <Link href={`/projects/${projectId}/patterns/${p.id}`} aria-label={`Open ${p.name}`} draggable={false} style={{ position: "absolute", inset: 0, zIndex: 1, borderRadius: "var(--radius-md)" }} />
                  <div className="thumb" style={{ aspectRatio: "4 / 5", padding: "var(--space-2)" }}>
                    <div style={{ width: "100%", maxHeight: "100%", display: "grid", placeItems: "center" }}>
                      <div style={{ width: p.size.w / p.size.h > 0.8 ? "100%" : `${(p.size.w / p.size.h / 0.8) * 100}%`, boxShadow: "0 1px 4px rgba(23,17,11,.18)" }}>
                        <PatternPreview pattern={p} />
                      </div>
                    </div>
                  </div>
                  <p className="label" style={{ margin: "var(--space-3) 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</p>
                  <p className="eyebrow" style={{ margin: "2px 0 0" }}>{p.size.name} · {p.size.w}x{p.size.h}</p>
                  <span style={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
                    <Menu trigger={<IconButton label={`Actions for ${p.name}`}><MoreHorizontal size={16} /></IconButton>} items={menu(p)} />
                  </span>
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
                <strong>{ACTOR_LABEL[a.actor] ?? a.actor}</strong> {(ACTION_TEXT[a.action] ?? ((s: string | null) => `${a.action} ${s ?? ""}`))(a.subject, a.detail)}
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
