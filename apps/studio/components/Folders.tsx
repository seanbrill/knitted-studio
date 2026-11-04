"use client";

// Folders, as every section shows them: where the person is (a trail back up), the
// folders in it (each one opens, and takes things dropped on it), and the dialogs that
// make, rename, move and delete them. Each section has folders of its own, so a page
// names its section and hands over its things, and this does the rest the same way
// everywhere. Deleting a folder deletes nothing in it, and the dialog says so.

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@knitted/core/client";
import { folderNames, folderProblem, foldersIn, isInside, joinFolder, nameOf, parentOf, type FolderSection } from "@knitted/core";
import { Button, ConfirmDialog, ContextMenu, Dialog, Field, IconButton, Input, Menu, icons, useToast, type MenuItems } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { RenameDialog } from "./ProjectsView";

const { Folder, FolderInput, FolderOpen, FolderPlus, ChevronRight, MoreHorizontal, Pencil, Trash2 } = icons;

/** What each section is called at its top, and what it holds. */
export const SECTION: Record<FolderSection, { top: string; one: string; many: string }> = {
  patterns: { top: "Patterns", one: "pattern", many: "patterns" },
  yarn: { top: "Yarn", one: "file", many: "files" },
  parts: { top: "Parts", one: "part", many: "parts" },
  swatches: { top: "Swatches", one: "swatch", many: "swatches" },
  knits: { top: "Knits", one: "knit", many: "knits" },
};
export const counted = (n: number, section: FolderSection) => `${n} ${n === 1 ? SECTION[section].one : SECTION[section].many}`;
const nameIn = (path: string, section: FolderSection) => (path ? nameOf(path) : SECTION[section].top);

const DRAG = "application/x-knitted-things";
type Dragged = { section: FolderSection; ids?: string[]; folder?: string };
/** A thing that can be filed: its id, and the folder it is in now. */
export type Filed = { id: string; folder: string };
type Asked = null | { kind: "new" } | { kind: "rename"; path: string } | { kind: "delete"; path: string } | { kind: "move"; things: Filed[]; label: string } | { kind: "move-folder"; path: string };

export type FolderKit = ReturnType<typeof useFolders>;

/**
 * A section's folders and which one the person is in. On a section's own page, where
 * they are is in the address (?folder=), so Back goes up and a reload stays put; in the
 * editor's side panels it is the panel's own. `things` are the section's things, for
 * counting what each folder holds.
 */
export function useFolders(projectId: string, section: FolderSection, things: Filed[] | null, { inAddress = true, start = "", onChanged }: { inAddress?: boolean; start?: string; onChanged?: () => void } = {}) {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: folders, refresh } = useLive(() => api.folders.list(projectId, section), [projectId, section]);
  const [own, setOwn] = useState(start);
  const [asked, ask] = useState<Asked>(null);
  const [over, setOver] = useState<string | null>(null);
  const here = inAddress ? folderNames(params.get("folder") ?? "").join("/") : own;

  const hrefFor = useCallback((path: string) => {
    const q = new URLSearchParams(params.toString());
    if (path) q.set("folder", path); else q.delete("folder");
    const s = q.toString();
    return s ? `${pathname}?${s}` : pathname;
  }, [params, pathname]);
  const open = useCallback((path: string) => { if (inAddress) router.push(hrefFor(path), { scroll: false }); else setOwn(path); }, [inAddress, hrefFor, router]);

  const changed = useCallback(async () => { await refresh(); onChanged?.(); }, [refresh, onChanged]);
  const attempt = useCallback(async (fn: () => Promise<unknown>) => { try { await fn(); return true; } catch (e) { toast((e as Error).message); return false; } }, [toast]);

  /** File things in `to`, with Undo putting each back where it was. */
  const move = useCallback(async (moving: Filed[], to: string) => {
    const go = moving.filter((t) => t.folder !== to);
    if (!go.length) return;
    let into = to;
    if (!(await attempt(async () => { into = (await api.folders.move(projectId, section, go.map((t) => t.id), to)).folder; }))) return;
    await changed();
    const back = async () => {
      for (const from of new Set(go.map((t) => t.folder))) await attempt(() => api.folders.move(projectId, section, go.filter((t) => t.folder === from).map((t) => t.id), from));
      await changed();
    };
    toast(`Moved ${go.length === 1 ? "it" : counted(go.length, section)} ${into ? `into ${nameOf(into)}` : `to the top of ${SECTION[section].top}`}`, { label: "Undo", onClick: back }, 10_000);
  }, [attempt, changed, projectId, section, toast]);

  /** Move a folder, and everything in it, into another. */
  const moveFolder = useCallback(async (path: string, into: string) => {
    if (parentOf(path) === into || isInside(into, path)) return;
    if (await attempt(() => api.folders.rename(projectId, section, path, joinFolder(into, nameOf(path))))) {
      await changed();
      toast(`Moved ${nameOf(path)} ${into ? `into ${nameOf(into)}` : `to the top of ${SECTION[section].top}`}`);
    }
  }, [attempt, changed, projectId, section, toast]);

  const countIn = useCallback((path: string) => (things ?? []).filter((t) => isInside(t.folder, path)).length, [things]);

  // Things dragged from this section, onto a folder or a crumb, are filed in it.
  const dragThings = useCallback((ids: string[]) => (e: React.DragEvent) => { e.dataTransfer.setData(DRAG, JSON.stringify({ section, ids })); e.dataTransfer.effectAllowed = "move"; }, [section]);
  const dragFolder = useCallback((path: string) => (e: React.DragEvent) => { e.dataTransfer.setData(DRAG, JSON.stringify({ section, folder: path })); e.dataTransfer.effectAllowed = "move"; }, [section]);
  const ours = (e: React.DragEvent) => [...e.dataTransfer.types].includes(DRAG);
  const dropInto = (path: string) => ({
    "data-drop": over === path ? true : undefined,
    onDragOver: (e: React.DragEvent) => { if (!ours(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== path) setOver(path); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === path ? null : o)); },
    onDrop: (e: React.DragEvent) => {
      if (!ours(e)) return;
      e.preventDefault(); e.stopPropagation(); setOver(null);
      let d: Dragged;
      try { d = JSON.parse(e.dataTransfer.getData(DRAG)); } catch { return; }
      if (d.section !== section) return;
      if (d.folder) void moveFolder(d.folder, path);
      else if (d.ids?.length) { const at = new Map((things ?? []).map((t) => [t.id, t.folder])); void move(d.ids.map((id) => ({ id, folder: at.get(id) ?? "" })), path); }
    },
  });

  const menuFor = (path: string): MenuItems => [
    { label: "Open", icon: <FolderOpen size={14} />, onSelect: () => open(path) },
    { label: "Rename", icon: <Pencil size={14} />, onSelect: () => ask({ kind: "rename", path }) },
    { label: "Move to folder", icon: <FolderInput size={14} />, onSelect: () => ask({ kind: "move-folder", path }) },
    "separator",
    { label: "Delete folder", icon: <Trash2 size={14} />, danger: true, onSelect: () => ask({ kind: "delete", path }) },
  ];

  return {
    projectId, section, folders, here, inAddress, hrefFor, open, refresh, changed, attempt, move, moveFolder, countIn, dragThings, dragFolder, dropInto, menuFor, asked, ask,
    /** The folder the person is in has gone: renamed or deleted, perhaps by their model. */
    gone: !!folders && !!here && !folders.includes(here),
    askMove: (moving: Filed[], label: string) => ask({ kind: "move", things: moving, label }),
    askNew: () => ask({ kind: "new" }),
  };
}

/** The trail from the top of the section to the folder the person is in. Each step up takes things dropped on it. */
export function FolderCrumbs({ kit }: { kit: FolderKit }) {
  if (!kit.here) return null;
  const names = kit.here.split("/");
  const paths = names.map((_, i) => names.slice(0, i + 1).join("/"));
  const step = (path: string, label: string) => kit.inAddress
    ? <Link href={kit.hrefFor(path)} scroll={false} {...kit.dropInto(path)}>{label}</Link>
    : <button type="button" onClick={() => kit.open(path)} {...kit.dropInto(path)}>{label}</button>;
  return (
    <nav aria-label={`Where you are in ${SECTION[kit.section].top}`} style={{ marginBottom: "var(--space-3)" }}>
      <ol className="crumbs">
        <li>{step("", SECTION[kit.section].top)}</li>
        {paths.map((p, i) => (
          <li key={p}>
            <ChevronRight size={13} aria-hidden />
            {i === paths.length - 1 ? <span aria-current="location" style={{ padding: "2px 6px" }}>{names[i]}</span> : step(p, names[i])}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The folders inside the one the person is in. Each opens, and takes things or folders dropped on it. */
export function FolderList({ kit, compact }: { kit: FolderKit; compact?: boolean }) {
  if (kit.gone) {
    const up = (kit.folders ?? []).includes(parentOf(kit.here)) ? parentOf(kit.here) : "";
    return (
      <p role="status" className="body-sm" style={{ margin: "0 0 var(--space-4)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        This folder is not here any more. It may have been renamed or deleted.
        <Button size="sm" onClick={() => kit.open(up)}>Go to {nameIn(up, kit.section)}</Button>
      </p>
    );
  }
  const list = kit.folders ? foldersIn(kit.folders, kit.here) : [];
  if (!list.length) return null;
  return (
    <ul aria-label={`Folders in ${nameIn(kit.here, kit.section)}`}
      style={{ listStyle: "none", margin: "0 0 var(--space-4)", padding: 0, display: "grid", gap: compact ? 6 : "var(--space-3)", gridTemplateColumns: compact ? "1fr" : "repeat(auto-fill, minmax(210px, 1fr))" }}>
      {list.map((f) => <FolderTile key={f} kit={kit} path={f} />)}
    </ul>
  );
}

function FolderTile({ kit, path }: { kit: FolderKit; path: string }) {
  const n = kit.countIn(path);
  const inside = foldersIn(kit.folders ?? [], path).length;
  const facts = n || inside ? [inside && `${inside} folder${inside === 1 ? "" : "s"}`, n && counted(n, kit.section)].filter(Boolean).join(", ") : "Empty";
  const items = kit.menuFor(path);
  // One empty control covers the tile and carries its name, so what is announced and what is shown cannot disagree.
  const name = `${nameOf(path)}, folder, ${facts}`;
  const cover: React.CSSProperties = { position: "absolute", inset: 0, zIndex: 1, background: "transparent", border: 0, cursor: "pointer", borderRadius: "var(--radius-md)" };
  return (
    <li>
      <ContextMenu items={items}>
        <div className="card card-link" draggable onDragStart={kit.dragFolder(path)} {...kit.dropInto(path)}
          style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "8px 6px 8px 12px" }}>
          {kit.inAddress ? <Link href={kit.hrefFor(path)} scroll={false} aria-label={name} draggable={false} style={cover} /> : <button type="button" aria-label={name} onClick={() => kit.open(path)} style={cover} />}
          <Folder size={18} aria-hidden style={{ color: "var(--ember-ink)", flexShrink: 0 }} />
          <span aria-hidden style={{ minWidth: 0, flex: 1 }}>
            <span className="label" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(path)}</span>
            <span className="eyebrow" style={{ display: "block", marginTop: 1 }}>{facts}</span>
          </span>
          <span style={{ position: "relative", zIndex: 2 }}>
            <Menu trigger={<IconButton label={`Actions for the folder ${nameOf(path)}`}><MoreHorizontal size={16} /></IconButton>} items={items} />
          </span>
        </div>
      </ContextMenu>
    </li>
  );
}

/** The button that makes a folder in the one the person is in. */
export function NewFolderButton({ kit, size }: { kit: FolderKit; size?: "sm" }) {
  return <Button size={size} onClick={kit.askNew}><FolderPlus size={14} aria-hidden /> New folder</Button>;
}

/** Every folder dialog for one section: New, Rename, Move (things or a folder) and Delete. */
export function FolderDialogs({ kit }: { kit: FolderKit }) {
  const toast = useToast();
  const a = kit.asked;
  const close = (o: boolean) => { if (!o) kit.ask(null); };
  const top = SECTION[kit.section].top;
  return (
    <>
      <NewFolderDialog open={a?.kind === "new"} onOpenChange={close} where={nameIn(kit.here, kit.section)}
        onCreate={async (name) => {
          const want = joinFolder(kit.here, folderNames(name).join("/"));
          const problem = folderProblem(want);
          if (problem) throw new Error(problem);
          if ((kit.folders ?? []).some((f) => f.toLowerCase() === want.toLowerCase())) throw new Error(`There is a folder called ${nameOf(want)} here already.`);
          const { path } = await api.folders.create(kit.projectId, kit.section, want);
          await kit.changed();
          toast(`Made the folder ${nameOf(path)}`);
        }} />
      <RenameDialog open={a?.kind === "rename"} onOpenChange={close} title="Rename folder" initial={a?.kind === "rename" ? nameOf(a.path) : ""}
        onSave={async (name) => {
          if (a?.kind !== "rename") return;
          if (name.includes("/")) throw new Error("A folder's name cannot have a / in it. To put it in another folder, choose Move to folder.");
          const to = joinFolder(parentOf(a.path), name);
          const problem = folderProblem(to);
          if (problem) throw new Error(problem);
          await api.folders.rename(kit.projectId, kit.section, a.path, to);
          await kit.changed();
        }} />
      <MoveDialog open={a?.kind === "move" || a?.kind === "move-folder"} onOpenChange={close} kit={kit}
        title={a?.kind === "move" ? `Move ${a.label}` : a?.kind === "move-folder" ? `Move the folder ${nameOf(a.path)}` : "Move"}
        from={a?.kind === "move" ? (new Set(a.things.map((t) => t.folder)).size === 1 ? a.things[0].folder : null) : a?.kind === "move-folder" ? parentOf(a.path) : null}
        moving={a?.kind === "move-folder" ? a.path : null}
        onMove={async (to) => {
          if (a?.kind === "move") await kit.move(a.things, to);
          else if (a?.kind === "move-folder") await kit.moveFolder(a.path, to);
        }} />
      {a?.kind === "delete" && (() => {
        const n = kit.countIn(a.path);
        const inside = (kit.folders ?? []).filter((f) => f !== a.path && isInside(f, a.path)).length;
        const what = [inside && `${inside} folder${inside === 1 ? "" : "s"}`, n && counted(n, kit.section)].filter(Boolean).join(" and ");
        const up = nameIn(parentOf(a.path), kit.section);
        return (
          <ConfirmDialog open onOpenChange={close} title={`Delete the folder ${nameOf(a.path)}?`} confirmLabel="Delete folder"
            description={what ? `The ${what} in it ${inside + n === 1 ? "moves" : "move"} up to ${up}. Nothing in it is deleted.` : `It is empty. Nothing else changes in ${top}.`}
            onConfirm={async () => {
              if (await kit.attempt(() => api.folders.remove(kit.projectId, kit.section, a.path))) {
                if (isInside(kit.here, a.path)) kit.open(parentOf(a.path));
                await kit.changed();
                toast(what ? `Deleted ${nameOf(a.path)}. What was in it is in ${up}.` : `Deleted ${nameOf(a.path)}`);
              }
            }} />
        );
      })()}
    </>
  );
}

function NewFolderDialog({ open, onOpenChange, where, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; where: string; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | undefined>();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setName(""); setErr(undefined); }
  }, [open]);
  const save = async () => {
    if (!folderNames(name).length) { setErr("Give the folder a name."); return; }
    try { await onCreate(name); onOpenChange(false); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New folder" description={`In ${where}. Use / to make folders inside it at once, like Royalty free music/Lo-fi.`}
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={save}>Make folder</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Name" error={err} htmlFor="nf-name"><Input id="nf-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Royalty free music" /></Field>
      </form>
    </Dialog>
  );
}

/**
 * Where to move something: every folder in the section, as a list to pick one from, with
 * a folder made on the spot. `from` is where it is now (null when the things are in
 * different ones); `moving`, a folder, cannot go inside itself.
 */
function MoveDialog({ open, onOpenChange, kit, title, from, moving, onMove }: {
  open: boolean; onOpenChange: (o: boolean) => void; kit: FolderKit; title: string; from: string | null; moving: string | null; onMove: (to: string) => Promise<void>;
}) {
  const [to, setTo] = useState("");
  const [fresh, setFresh] = useState("");
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setTo(kit.here !== from ? kit.here : ""); setFresh(""); setErr(undefined); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => ["", ...(kit.folders ?? [])], [kit.folders]);
  const blocked = (f: string) => !!moving && isInside(f, moving);
  const make = async () => {
    const want = joinFolder(to, folderNames(fresh).join("/"));
    if (!folderNames(fresh).length) { setErr("Give the folder a name."); return; }
    const problem = folderProblem(want);
    if (problem) { setErr(problem); return; }
    try { const { path } = await api.folders.create(kit.projectId, kit.section, want); await kit.refresh(); setTo(path); setFresh(""); setErr(undefined); } catch (e) { setErr((e as Error).message); }
  };
  const go = async () => { setBusy(true); try { await onMove(to); onOpenChange(false); } finally { setBusy(false); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description="Choose the folder it goes in."
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={busy || to === from || blocked(to)} onClick={go}>Move here</Button></>}>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="sr-only">Folder to move it to</legend>
        <ul style={{ listStyle: "none", margin: 0, padding: 4, display: "grid", gap: 2, maxHeight: 280, overflow: "auto", border: "1px solid var(--line)", borderRadius: "var(--radius-md)" }}>
          {all.map((f) => (
            <li key={f || "(top)"}>
              <label className="body-sm" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", paddingLeft: 8 + (f ? f.split("/").length : 0) * 16, borderRadius: "var(--radius-sm)", cursor: blocked(f) ? "not-allowed" : "pointer", opacity: blocked(f) ? 0.5 : 1, background: to === f ? "var(--tint)" : undefined }}>
                <input type="radio" name="move-to" value={f} checked={to === f} disabled={blocked(f)} onChange={() => setTo(f)} />
                <Folder size={15} aria-hidden style={{ color: "var(--ember-ink)", flexShrink: 0 }} />
                <span>{f ? nameOf(f) : `${SECTION[kit.section].top}, at the top`}{f === from ? <span style={{ color: "var(--ink-muted)" }}> (where it is now)</span> : null}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <form onSubmit={(e) => { e.preventDefault(); void make(); }} style={{ display: "flex", gap: 8, alignItems: "end", marginTop: "var(--space-3)" }}>
        <div style={{ flex: 1 }}>
          <Field label={`New folder in ${nameIn(to, kit.section)}`} error={err} htmlFor="mv-new"><Input id="mv-new" value={fresh} onChange={(e) => setFresh(e.target.value)} placeholder="Lo-fi" /></Field>
        </div>
        <Button type="submit" disabled={!fresh.trim()}><FolderPlus size={14} aria-hidden /> Make it</Button>
      </form>
    </Dialog>
  );
}

/** A line saying which folder a thing is in, for results gathered from several. */
export function InFolder({ path }: { path: string }) {
  if (!path) return null;
  return <span className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}><Folder size={11} aria-hidden style={{ flexShrink: 0 }} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{path.split("/").join(" / ")}</span></span>;
}

/** Select options grouped by the folder each thing is in, for picking a file from Yarn. */
export const byFolder = <T extends { folder: string }>(xs: T[], option: (x: T) => { value: string; label: string }) =>
  [...xs].sort((a, b) => (a.folder === b.folder ? 0 : !a.folder ? -1 : !b.folder ? 1 : a.folder.localeCompare(b.folder, undefined, { numeric: true, sensitivity: "base" }))).map((x) => ({ ...option(x), group: x.folder ? x.folder.split("/").join(" / ") : undefined }));
