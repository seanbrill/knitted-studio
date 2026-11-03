"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api, type ProjectSummary } from "@knitted/core/client";
import {
  Button, Chip, ConfirmDialog, ContextMenu, Dialog, EmptyState, Field, IconButton, Input, Menu, SegmentedControl,
  Select, Skeleton, Textarea, icons, useToast, type MenuItems,
} from "@knitted/ui";
import { PageHeader } from "./AppShell";
import { timeAgo, useLive } from "@/lib/hooks";

const { Plus, Search, MoreHorizontal, Pencil, Copy, Archive, Trash2, FolderOpen } = icons;

type Sort = "recent" | "name" | "created";
type View = "grid" | "list";

function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>("grid");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { if (localStorage.getItem("knitted.projects.view") === "list") setView("list"); } catch {}
  }, []);
  return [view, (v) => { setView(v); try { localStorage.setItem("knitted.projects.view", v); } catch {} }];
}

function ProjectCard({ p, view, items, menuTrigger }: { p: ProjectSummary; view: View; items: MenuItems; menuTrigger: React.ReactElement }) {
  const card = (
    <div className="card card-link" style={{ position: "relative", padding: view === "grid" ? "var(--space-3)" : "var(--space-3) var(--space-4)", display: view === "list" ? "flex" : "block", alignItems: "center", gap: "var(--space-4)" }}>
      <Link href={`/projects/${p.id}`} aria-label={`Open ${p.name}`} style={{ position: "absolute", inset: 0, borderRadius: "var(--radius-md)", zIndex: 1 }} />
      {view === "grid" && (
        <div style={{ aspectRatio: "4 / 3", borderRadius: "var(--radius-sm)", background: p.example ? "var(--ember)" : "var(--surface-sunken)", display: "grid", placeItems: "center", marginBottom: "var(--space-3)" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 38, letterSpacing: "-0.04em", color: p.example ? "var(--on-ember)" : "var(--ink-muted)" }}>
            {p.name.slice(0, 1).toUpperCase()}
          </span>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="label" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</p>
        <p className="body-sm" style={{ margin: "2px 0 0", color: "var(--ink-muted)" }}>
          {p.counts.patterns} {p.counts.patterns === 1 ? "pattern" : "patterns"} · {p.counts.yarn} yarn · {timeAgo(p.updatedAt)}
        </p>
      </div>
      {p.example && <Chip tone="ember">Example</Chip>}
      <span style={{ position: "relative", zIndex: 2, ...(view === "grid" ? { position: "absolute", top: 8, right: 8 } : {}) }}>{menuTrigger}</span>
    </div>
  );
  return <ContextMenu items={items}>{card}</ContextMenu>;
}

function ProjectsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [view, setView] = useView();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [show, setShow] = useState<"active" | "archived">("active");
  const { data, refresh, error } = useLive(() => api.projects.list({ archived: show === "archived" }), [show]);

  const [creating, setCreating] = useState(params.get("new") === "1");
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);

  const list = useMemo(() => {
    const filtered = (data ?? []).filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
    return [...filtered].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
  }, [data, q, sort]);

  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try { await fn(); await refresh(); if (msg) toast(msg); } catch (e) { toast((e as Error).message); }
  };

  const menuFor = (p: ProjectSummary): MenuItems => [
    { label: "Open", icon: <FolderOpen size={14} />, onSelect: () => router.push(`/projects/${p.id}`) },
    { label: "Rename", icon: <Pencil size={14} />, onSelect: () => setRenaming(p) },
    { label: "Duplicate", icon: <Copy size={14} />, onSelect: () => act(() => api.projects.action(p.id, "duplicate"), `Duplicated ${p.name}`) },
    p.archivedAt
      ? { label: "Restore", icon: <Archive size={14} />, onSelect: () => act(() => api.projects.action(p.id, "restore"), `Restored ${p.name}`) }
      : { label: "Archive", icon: <Archive size={14} />, onSelect: () => act(() => api.projects.action(p.id, "archive"), `Archived ${p.name}`) },
    "separator",
    { label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleting(p) },
  ];

  return (
    <div style={{ padding: "var(--space-8)", maxWidth: 1200 }}>
      <PageHeader eyebrow="Library" title="Projects">
        <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> New project</Button>
      </PageHeader>

      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap", marginBottom: "var(--space-6)" }}>
        <div style={{ position: "relative", width: 280 }}>
          <Search size={15} aria-hidden style={{ position: "absolute", left: 10, top: 10, color: "var(--ink-muted)" }} />
          <Input aria-label="Search projects" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <div style={{ width: 160 }}>
          <Select aria-label="Sort" value={sort} onValueChange={(v) => setSort(v as Sort)} options={[{ value: "recent", label: "Recently updated" }, { value: "created", label: "Newest" }, { value: "name", label: "Name" }]} />
        </div>
        <SegmentedControl<"active" | "archived"> label="Show" value={show} onChange={setShow} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} />
        <div style={{ flex: 1 }} />
        <SegmentedControl<View> label="View" value={view} onChange={setView} options={[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }]} />
      </div>

      {error && <p role="alert" className="field-error">{error}</p>}
      {!data ? (
        <div style={{ display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={180} />)}
        </div>
      ) : list.length === 0 ? (
        q ? (
          <EmptyState title="No projects match" body={`Nothing is called "${q}". Try a shorter search.`} />
        ) : show === "archived" ? (
          <EmptyState title="Nothing archived" body="Archive a project to tuck it away without deleting it." />
        ) : (
          <EmptyState title="No projects yet" body="A project holds the Yarn, Swatch and Patterns for one brand." action={<Button variant="primary" onClick={() => setCreating(true)}>Create your first project</Button>} />
        )
      ) : (
        <div style={{ display: "grid", gap: "var(--space-4)", gridTemplateColumns: view === "grid" ? "repeat(auto-fill, minmax(240px, 1fr))" : "1fr" }}>
          {list.map((p) => (
            <ProjectCard
              key={p.id}
              p={p}
              view={view}
              items={menuFor(p)}
              menuTrigger={<Menu trigger={<IconButton label={`Actions for ${p.name}`}><MoreHorizontal size={16} /></IconButton>} items={menuFor(p)} />}
            />
          ))}
        </div>
      )}

      <NewProjectDialog open={creating} onOpenChange={(o) => { setCreating(o); if (!o && params.get("new")) router.replace("/projects"); }} onCreated={(p) => router.push(`/projects/${p.id}`)} />

      <RenameDialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="Rename project"
        initial={renaming?.name ?? ""}
        onSave={(name) => act(() => api.projects.update(renaming!.id, { name }))}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "project"}?`}
        description={deleting && deleting.counts.yarn + deleting.counts.patterns > 0
          ? `This removes ${deleting.counts.patterns} ${deleting.counts.patterns === 1 ? "pattern" : "patterns"} and ${deleting.counts.yarn} yarn. You can undo it for a while.`
          : "It is empty, so nothing is lost."}
        confirmLabel="Delete project"
        requireText={deleting && deleting.counts.yarn > 0 ? deleting.name : undefined}
        onConfirm={async () => {
          const p = deleting!;
          await api.projects.remove(p.id);
          await refresh();
          toast(`Deleted ${p.name}`, { label: "Undo", onClick: () => act(() => api.projects.action(p.id, "undelete"), `Restored ${p.name}`) }, 10_000);
        }}
      />
    </div>
  );
}

export function ProjectsView() {
  return <Suspense><ProjectsInner /></Suspense>;
}

// ── dialogs ─────────────────────────────────────────────────────────────────

export function NewProjectDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (p: { id: string }) => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [starter, setStarter] = useState<"social" | "blank">("social");
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setName(""); setDesc(""); setErr(undefined); setBusy(false); }
  }, [open]);
  const submit = async () => {
    setBusy(true);
    try { const p = await api.projects.create({ name, description: desc, starter }); onOpenChange(false); onCreated(p); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New project" description="One project per brand: it holds that brand's Yarn, Swatch and Patterns."
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={submit}>Create project</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label="Name" error={err} htmlFor="np-name"><Input id="np-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Launch week" /></Field>
        <Field label="Description (optional)" htmlFor="np-desc"><Textarea id="np-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} /></Field>
        <Field label="Start with">
          <SegmentedControl<"social" | "blank"> label="Start with" value={starter} onChange={setStarter} options={[{ value: "social", label: "Social starter pack" }, { value: "blank", label: "Blank" }]} />
          <span className="field-hint">{starter === "social" ? "Five patterns: Story, Post, Square, Landscape and Banner, each with a headline to fill." : "One empty pattern."}</span>
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function RenameDialog({ open, onOpenChange, title, initial, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; initial: string; onSave: (name: string) => Promise<unknown> | void }) {
  const [name, setName] = useState(initial);
  const [err, setErr] = useState<string | undefined>();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setName(initial); setErr(undefined); }
  }, [open, initial]);
  const save = async () => { try { await onSave(name); onOpenChange(false); } catch (e) { setErr((e as Error).message); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Name" error={err} htmlFor="rn-name"><Input id="rn-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} /></Field>
      </form>
    </Dialog>
  );
}
