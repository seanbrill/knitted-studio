"use client";

// Folders, as every section shows them: where the person is (a trail back up), the
// folders in it (each one opens, and takes things dropped on it), and the dialogs that
// make, rename, move and delete them. Each section has folders of its own, so a page
// names its section and hands over its things, and this does the rest the same way
// everywhere. Deleting a folder deletes nothing in it, and the dialog says so.

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@knitted/core/client";
import { folderNames, folderProblem, foldersIn, isInside, joinFolder, nameOf, parentOf, type FolderSection } from "@knitted/core";
import { Button, ConfirmDialog, ContextMenu, Dialog, Field, IconButton, Input, Menu, icons, useToast, type Crumb, type MenuItems } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { endedAt, leadOf, RECENT_MS, useAgent, useMarks, useNow, type Mark } from "@/lib/agent";
import { useFollow } from "@/lib/follow";
import { ModelMark } from "./ModelMark";
import { RenameDialog } from "./ProjectsView";
import { useTrail } from "./Trail";

const { Download, Folder, FolderInput, FolderOpen, FolderPlus, ChevronRight, MoreHorizontal, Pencil, Search, Trash2 } = icons;

/** What each section is called at its top, and what it holds. */
export const SECTION: Record<FolderSection, { top: string; one: string; many: string }> = {
  patterns: { top: "Patterns", one: "pattern", many: "patterns" },
  yarn: { top: "Yarn", one: "file", many: "files" },
  parts: { top: "Parts", one: "part", many: "parts" },
  swatches: { top: "Swatches", one: "swatch", many: "swatches" },
  knits: { top: "Knits", one: "knit", many: "knits" },
  reference: { top: "Reference", one: "file", many: "files" },
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
export function useFolders(projectId: string, section: FolderSection, things: Filed[] | null, { inAddress = true, start = "", onChanged, peek, zipOf }: {
  inAddress?: boolean; start?: string; onChanged?: () => void;
  /** Where a folder downloads as a zip, for a section that has them. */
  zipOf?: (path: string) => string;
  /** A small picture of a thing, for a peek at what a folder holds; null for one that has none. */
  peek?: (t: Filed) => string | null;
} = {}) {
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
  const attempt = useCallback(async (fn: () => Promise<unknown>) => { try { await fn(); return true; } catch (e) { toast.problem((e as Error).message); return false; } }, [toast]);

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
  /** Up to three pictures of what is in a folder, or in the folders inside it. */
  const peekIn = useCallback((path: string): string[] => {
    if (!peek) return [];
    const out: string[] = [];
    for (const t of things ?? []) {
      if (!isInside(t.folder, path)) continue;
      const src = peek(t);
      if (src) out.push(src);
      if (out.length === 3) break;
    }
    return out;
  }, [things, peek]);

  // Following a model that sorts this section, open the folder it works in, so what it files
  // or renames is in view. Once for each call, and only to a folder that is there.
  const agent = useAgent();
  const following = useFollow((f) => f.on);
  const now = useNow((t) => (agent?.calls ?? []).some((c) => c.state === "running" || t - endedAt(c) < RECENT_MS));
  const watch = following && inAddress ? [...(agent?.calls ?? [])].reverse().find((c) => c.where.projectId === projectId && c.where.section === section && c.where.folder !== undefined && (c.state === "running" || now - endedAt(c) < RECENT_MS)) : undefined;
  const watchKey = watch ? `${watch.id}|${watch.state}|${watch.where.folder}` : "";
  const opened = useRef("");
  useEffect(() => {
    if (!watch || opened.current === watchKey) return;
    const to = watch.where.folder!;
    if (to && !(folders ?? []).includes(to)) return; // not made yet: the call's end says where it is
    opened.current = watchKey;
    if (to !== here) router.push(hrefFor(to), { scroll: false }); // following is only ever in the address
  }, [watchKey, folders]); // eslint-disable-line react-hooks/exhaustive-deps

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
    { label: "New folder in it", icon: <FolderPlus size={14} />, onSelect: () => { open(path); ask({ kind: "new" }); } },
    "separator",
    { label: "Rename", icon: <Pencil size={14} />, onSelect: () => ask({ kind: "rename", path }) },
    { label: "Move to folder", icon: <FolderInput size={14} />, onSelect: () => ask({ kind: "move-folder", path }) },
    ...(zipOf ? [{ label: "Download, as a zip", icon: <Download size={14} />, onSelect: () => { const a = document.createElement("a"); a.href = zipOf(path); document.body.append(a); a.click(); a.remove(); } }] : []),
    "separator",
    { label: "Delete the folder", icon: <Trash2 size={14} />, danger: true, hint: "What is in it moves up", onSelect: () => ask({ kind: "delete", path }) },
  ];

  return {
    projectId, section, folders, here, inAddress, hrefFor, open, refresh, changed, attempt, move, moveFolder, countIn, peekIn, peeks: !!peek, dragThings, dragFolder, dropInto, menuFor, asked, ask,
    /** The folder the person is in has gone: renamed or deleted, perhaps by their model. */
    gone: !!folders && !!here && !folders.includes(here),
    askMove: (moving: Filed[], label: string) => ask({ kind: "move", things: moving, label }),
    askNew: () => ask({ kind: "new" }),
    /** A small picture of one thing, when the section has them. */
    peekOf: (t: Filed) => (peek ? peek(t) : null),
  };
}

/**
 * The trail from the top of the section to the folder the person is in. Each step up takes
 * things dropped on it. On a project's page the steps join the project's own trail at the
 * top, so there is one; in the editor's side panels they are drawn here.
 */
export function FolderCrumbs({ kit }: { kit: FolderKit }) {
  const trail = useTrail();
  const latest = useRef(kit);
  useEffect(() => { latest.current = kit; });
  const joins = !!trail && kit.inAddress;
  const lit = kit.here ? kit.here.split("/").map((_, i, all) => (kit.dropInto(all.slice(0, i + 1).join("/"))["data-drop"] ? 1 : 0)).join("") + (kit.dropInto("")["data-drop"] ? 1 : 0) : "";
  const key = `${kit.section}|${kit.here}|${kit.hrefFor("")}|${lit}`;
  useEffect(() => {
    if (!joins) return;
    const k = latest.current;
    if (!k.here) { trail!(null); return; }
    const names = k.here.split("/");
    // Handlers that read the kit as it is when something is dropped, not as it was when the trail was made.
    const drop = (path: string): Crumb["props"] => ({
      ...({ "data-drop": k.dropInto(path)["data-drop"] } as object),
      onDragOver: (e) => latest.current.dropInto(path).onDragOver(e), onDragLeave: (e) => latest.current.dropInto(path).onDragLeave(e), onDrop: (e) => latest.current.dropInto(path).onDrop(e),
    });
    trail!([
      { label: SECTION[k.section].top, href: k.hrefFor(""), props: drop(""), title: `The top of ${SECTION[k.section].top}` },
      ...names.map((n, i) => { const path = names.slice(0, i + 1).join("/"); return i === names.length - 1 ? { label: n } : { label: n, href: k.hrefFor(path), props: drop(path) }; }),
    ]);
  }, [joins, key, trail]);
  useEffect(() => (joins ? () => trail!(null) : undefined), [joins, trail]);
  if (joins || !kit.here) return null;
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
  return <Tiles kit={kit} compact={compact} />;
}

function Tiles({ kit, compact }: { kit: FolderKit; compact?: boolean }) {
  // A model filing things or renaming a folder: the folder it works on is outlined, or the one here it is inside.
  const worked = useMarks((w) => (w.projectId === kit.projectId && w.section === kit.section ? w.folders : null));
  const list = kit.folders ? foldersIn(kit.folders, kit.here) : [];
  if (!list.length) return null;
  const marks = new Map<string, Mark>();
  for (const f of list) for (const [path, m] of worked) if (isInside(path, f) && (!marks.has(f) || marks.get(f)!.at < m.at)) marks.set(f, m);
  const lead = leadOf(marks);
  return (
    <ul className="arrive-list" aria-label={`Folders in ${nameIn(kit.here, kit.section)}`}
      style={{ listStyle: "none", margin: "0 0 var(--space-4)", padding: 0, display: "grid", gap: compact ? 6 : "var(--space-3)", gridTemplateColumns: compact ? "1fr" : `repeat(auto-fill, minmax(${kit.peeks ? 250 : 210}px, 1fr))` }}>
      {list.map((f) => <FolderTile key={f} kit={kit} path={f} mark={marks.get(f)} lead={lead === f} />)}
    </ul>
  );
}

function FolderTile({ kit, path, mark, lead }: { kit: FolderKit; path: string; mark?: Mark; lead?: boolean }) {
  const n = kit.countIn(path);
  const inside = foldersIn(kit.folders ?? [], path).length;
  const facts = n || inside ? [inside && `${inside} folder${inside === 1 ? "" : "s"}`, n && counted(n, kit.section)].filter(Boolean).join(", ") : "Empty";
  const items = kit.menuFor(path);
  const peeks = kit.peekIn(path);
  // One empty control covers the tile and carries its name, so what is announced and what is shown cannot disagree.
  const name = `${nameOf(path)}, folder, ${facts}`;
  const cover: React.CSSProperties = { position: "absolute", inset: 0, zIndex: 1, background: "transparent", border: 0, cursor: "pointer", borderRadius: "var(--radius-md)" };
  return (
    <li>
      <ContextMenu items={items}>
        <div className="card card-link" draggable onDragStart={kit.dragFolder(path)} {...kit.dropInto(path)}
          style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, height: 58, padding: "0 6px 0 12px" }}>
          {kit.inAddress ? <Link href={kit.hrefFor(path)} scroll={false} aria-label={name} draggable={false} style={cover} /> : <button type="button" aria-label={name} onClick={() => kit.open(path)} style={cover} />}
          <Folder size={18} aria-hidden style={{ color: "var(--ember-ink)", flexShrink: 0 }} />
          <span aria-hidden style={{ minWidth: 0, flex: 1 }}>
            <span className="label" title={nameOf(path)} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(path)}</span>
            <span className="body-sm" style={{ display: "block", marginTop: 2, color: "var(--ink-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{facts}</span>
          </span>
          {peeks.length > 0 && <span aria-hidden className="folder-peek">{peeks.map((src) => <img key={src} src={src} alt="" loading="lazy" draggable={false} onError={(e) => { e.currentTarget.style.display = "none"; }} />)}</span>}
          <span style={{ position: "relative", zIndex: 2 }}>
            <Menu trigger={<IconButton label={`Actions for the folder ${nameOf(path)}`}><MoreHorizontal size={16} /></IconButton>} items={items} />
          </span>
          <ModelMark mark={mark} lead={lead} />
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
      <NewFolderDialog open={a?.kind === "new"} onOpenChange={close} kit={kit}
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
        moving={a?.kind === "move-folder" ? a.path : null} things={a?.kind === "move" ? a.things : []}
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
          <ConfirmDialog open onOpenChange={close} title={`Delete the folder ${nameOf(a.path)}?`} confirmLabel="Delete the folder"
            sub={[top, ...a.path.split("/")].join(" / ")}
            description={what
              ? <><strong>Nothing in it is deleted.</strong> {inside + n === 1 ? "The" : "Its"} {what} in it {inside + n === 1 ? "moves" : "move"} up to {up === top ? `${top}, at the top` : up}.</>
              : <>It is empty. Nothing else changes in {top}.</>}
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

/** A new folder where the person is: the path it makes is shown as they type, and a name taken says so with a way to it. */
function NewFolderDialog({ open, onOpenChange, kit, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; kit: FolderKit; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | undefined>();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setName(""); setErr(undefined); }
  }, [open]);
  const parts = folderNames(name);
  const have = new Set((kit.folders ?? []).map((f) => f.toLowerCase()));
  const steps = parts.map((p, i) => ({ name: p, path: joinFolder(kit.here, parts.slice(0, i + 1).join("/")) }));
  const fresh = steps.filter((s) => !have.has(s.path.toLowerCase()));
  const taken = steps.length > 0 && fresh.length === 0 ? steps[steps.length - 1]!.path : null;
  const save = async () => {
    if (!parts.length) { setErr("Give the folder a name."); return; }
    if (taken) return;
    try { await onCreate(name); onOpenChange(false); } catch (e) { setErr((e as Error).message); }
  };
  const top = SECTION[kit.section].top;
  const where = kit.here ? `${top} / ${kit.here.split("/").join(" / ")}` : top;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New folder" description={`In ${where}`}
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={!!taken} onClick={save}>{fresh.length > 1 ? `Make ${fresh.length} folders` : "Make the folder"}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: "grid", gap: "var(--space-2)" }}>
        <Field label="Name" error={err} htmlFor="nf-name"
          hint={taken ? undefined : "A / makes a folder inside it, all at once, like Royalty free music/Lo-fi."}>
          <Input id="nf-name" autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr(undefined); }} placeholder="Royalty free music" aria-invalid={!!taken || undefined} />
          {steps.length > 0 && !taken && (
            <p className="folder-path" aria-label="The folders it makes">
              <span>{top}</span>
              {[...(kit.here ? kit.here.split("/") : []).map((n) => ({ n, made: false })), ...steps.map((s) => ({ n: s.name, made: !have.has(s.path.toLowerCase()) }))].map((x, i) => <span key={i} data-new={x.made || undefined}><ChevronRight size={11} aria-hidden />{x.n}</span>)}
            </p>
          )}
        </Field>
        {taken && <p className="field-error" role="alert">{nameIn(parentOf(taken), kit.section)} has a folder called {nameOf(taken)} already. <button type="button" className="link" onClick={() => { onOpenChange(false); kit.open(taken); }}>Open it</button></p>}
      </form>
    </Dialog>
  );
}

/**
 * Where to move something: the section's folders as a tree, kept short. The folders on the
 * way to where it is now, and to the one lit, are open; the rest are closed, and a search
 * opens what matches. A folder made here goes in the one lit and is picked. `from` is where
 * it is now (null when the things are in different ones); `moving`, a folder, cannot go
 * inside itself. `things` are what moves, for their pictures.
 */
function MoveDialog({ open, onOpenChange, kit, title, from, moving, things, onMove }: {
  open: boolean; onOpenChange: (o: boolean) => void; kit: FolderKit; title: string; from: string | null; moving: string | null; things: Filed[];
  onMove: (to: string) => Promise<void>;
}) {
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [making, setMaking] = useState<string | null>(null);
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const rows = useRef(new Map<string, HTMLDivElement | null>());
  const top = SECTION[kit.section].top;
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTo(kit.here !== from ? kit.here : ""); setQ(""); setShut(new Set()); setOpened(new Set()); setMaking(null); setErr(undefined);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => [...(kit.folders ?? [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })), [kit.folders]);
  const kids = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of all) { const up = parentOf(f); m.set(up, [...(m.get(up) ?? []), f]); }
    return m;
  }, [all]);
  const blocked = (f: string) => !!moving && isInside(f, moving);
  const ancestors = (f: string) => { const out: string[] = []; for (let p = f; p; p = parentOf(p)) out.push(parentOf(p)); return out; };
  const query = q.trim().toLowerCase();
  const hits = useMemo(() => (query ? all.filter((f) => nameOf(f).toLowerCase().includes(query)) : []), [all, query]);
  // What shows: on a search, the folders that match and the ones on the way to them; otherwise
  // the tree with the way to where it is now and to the one lit open, and what the person opened.
  const isOpen = (f: string) => {
    if (f === "") return true;
    if (query) return hits.some((h) => h !== f && isInside(h, f));
    if (shut.has(f)) return false;
    return opened.has(f) || (from !== null && from !== f && isInside(from, f)) || (to !== f && isInside(to, f)) || making === f;
  };
  const shown = (() => {
    const keep = query ? new Set(hits.flatMap((h) => [h, ...ancestors(h)])) : null;
    const out: { path: string; level: number }[] = [];
    const walk = (p: string, level: number) => {
      out.push({ path: p, level });
      if (!isOpen(p)) return;
      for (const k of kids.get(p) ?? []) if (!keep || keep.has(k)) walk(k, level + 1);
    };
    walk("", 0);
    return out;
  })();
  useEffect(() => {
    // A search lights the first folder it finds, so Enter moves there.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (query && hits.length && !hits.includes(to)) setTo(hits.find((h) => !blocked(h)) ?? to);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (f: string, want?: boolean) => {
    const now = isOpen(f);
    const next = want ?? !now;
    if (next === now) return false;
    setShut((s) => { const n = new Set(s); if (next) n.delete(f); else n.add(f); return n; });
    setOpened((s) => { const n = new Set(s); if (next) n.add(f); else n.delete(f); return n; });
    return true;
  };
  const pick = (f: string, focus = true) => { setTo(f); if (focus) rows.current.get(f)?.focus(); };
  // The folder lit is always in sight, however it was lit: a search, a key, a folder just made.
  useEffect(() => { if (open) rows.current.get(to)?.scrollIntoView({ block: "nearest" }); }, [open, to, kit.folders]);
  const go = async () => {
    if (to === from || blocked(to) || busy) return;
    setBusy(true); try { await onMove(to); onOpenChange(false); } finally { setBusy(false); }
  };
  const make = async () => {
    const names = folderNames(making ?? "");
    if (!names.length) { setMaking(null); return; }
    const want = joinFolder(to, names.join("/"));
    const problem = folderProblem(want);
    if (problem) { setErr(problem); return; }
    if (all.some((f) => f.toLowerCase() === want.toLowerCase())) { setErr(`${nameIn(to, kit.section)} has a folder called ${nameOf(want)} already.`); return; }
    try { const { path } = await api.folders.create(kit.projectId, kit.section, want); await kit.refresh(); setMaking(null); setErr(undefined); setTo(path); } catch (e) { setErr((e as Error).message); }
  };
  const keys = (e: React.KeyboardEvent, f: string, i: number) => {
    const at = (j: number) => shown[Math.max(0, Math.min(shown.length - 1, j))]!.path;
    if (e.key === "ArrowDown") { e.preventDefault(); pick(at(i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (i === 0) document.getElementById("mv-find")?.focus(); else pick(at(i - 1)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); if (!(kids.get(f)?.length) || !toggle(f, true)) { const k = kids.get(f)?.[0]; if (k && isOpen(f)) pick(k); } }
    else if (e.key === "ArrowLeft") { e.preventDefault(); if (!toggle(f, false) && f) pick(parentOf(f)); }
    else if (e.key === "Enter") { e.preventDefault(); void go(); }
  };
  const hit = (name: string) => {
    const i = query ? name.toLowerCase().indexOf(query) : -1;
    return i < 0 ? name : <>{name.slice(0, i)}<mark>{name.slice(i, i + query.length)}</mark>{name.slice(i + query.length)}</>;
  };
  const pics = things.map((t) => kit.peekOf(t)).filter((x): x is string => !!x).slice(0, 3);
  const n = moving ? 1 : things.length;
  const fromWords = from === null ? `From ${new Set(things.map((t) => t.folder)).size} folders` : `From ${[top, ...(from ? from.split("/") : [])].join(" / ")}`;
  const toWords = to ? `To ${to.split("/").join(" / ")}` : `To ${top}, at the top`;
  const newRow = (level: number) => (
    <div className="move-new" style={{ paddingLeft: 8 + level * 18 }}>
      {making === null
        ? <button type="button" className="move-new-btn" onClick={() => { setMaking(""); setErr(undefined); }}><FolderPlus size={14} aria-hidden /> New folder in {nameIn(to, kit.section)}</button>
        : <form onSubmit={(e) => { e.preventDefault(); void make(); }} style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
            <FolderPlus size={14} aria-hidden style={{ color: "var(--ember-ink)", flexShrink: 0 }} />
            <Input id="mv-new" autoFocus aria-label={`New folder in ${nameIn(to, kit.section)}`} value={making} onChange={(e) => { setMaking(e.target.value); setErr(undefined); }} placeholder="Its name" style={{ height: 30 }} />
            <Button size="sm" type="submit" disabled={!making.trim()}>Make it</Button>
          </form>}
    </div>
  );
  // The new-folder row goes after what is in the lit folder, where the new one will be.
  // At the top, it goes first, where it is seen without scrolling past every folder.
  const lastIn = (() => { let j = shown.findIndex((r) => r.path === to); if (j <= 0) return j; const lv = shown[j]!.level; while (j + 1 < shown.length && shown[j + 1]!.level > lv) j++; return j; })();
  const toLevel = (shown.find((r) => r.path === to)?.level ?? 0) + 1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size={pics.length ? "lg" : "md"} title={title} description={fromWords}
      note={toWords}
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" busy={busy} disabled={to === from || blocked(to)} onClick={go}>{n === 1 ? "Move it here" : `Move ${n} here`}</Button></>}>
      <div className="move-body" data-pics={pics.length ? true : undefined}>
        {pics.length > 0 && (
          <div className="move-what" aria-hidden>
            <span className="move-pics">{pics.map((src, i) => <img key={i} src={src} alt="" style={{ "--i": pics.length - 1 - i } as React.CSSProperties} />)}</span>
            <span className="move-what-name">{n === 1 ? "1 " + SECTION[kit.section].one : counted(n, kit.section)}</span>
          </div>
        )}
        <div style={{ display: "grid", gap: "var(--space-2)", minWidth: 0 }}>
          <label className="move-find">
            <Search size={14} aria-hidden />
            <input id="mv-find" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a folder" aria-label="Find a folder"
              onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); pick(shown.find((r) => r.path === to) ? to : shown[0]!.path); } else if (e.key === "Enter") { e.preventDefault(); void go(); } }} />
          </label>
          <div className="move-tree" role="tree" aria-label="Folder to move it to">
            {shown.map((r, i) => {
              const has = !!kids.get(r.path)?.length;
              const lit = r.path === to;
              return (
                <Fragment key={r.path || "(top)"}>
                  <div ref={(el) => { rows.current.set(r.path, el); }} role="treeitem" aria-level={r.level + 1} aria-selected={lit} aria-expanded={has && r.path ? isOpen(r.path) : undefined}
                    aria-disabled={blocked(r.path) || undefined} tabIndex={lit ? 0 : -1} className="move-row" style={{ paddingLeft: 8 + r.level * 18 }}
                    onClick={() => !blocked(r.path) && pick(r.path)} onDoubleClick={() => { if (!blocked(r.path) && r.path !== from) void go(); }} onKeyDown={(e) => keys(e, r.path, i)}>
                    <span className="move-twist" data-has={has && r.path ? true : undefined} data-open={isOpen(r.path) || undefined}
                      onClick={(e) => { if (has && r.path) { e.stopPropagation(); toggle(r.path); } }}><ChevronRight size={12} aria-hidden /></span>
                    <Folder size={14} aria-hidden className="move-icon" />
                    <span className="move-name">{r.path ? hit(nameOf(r.path)) : `${top}, at the top`}</span>
                    {r.path === from ? <span className="move-now">where {n === 1 ? "it is" : "they are"} now</span> : <span className="move-count">{kit.countIn(r.path)}</span>}
                  </div>
                  {i === lastIn && !query && newRow(toLevel)}
                </Fragment>
              );
            })}
            {query && !hits.length && <div className="move-none"><p>No folder is called that.</p>{newRow(0)}</div>}
          </div>
          {err ? <span className="field-error" role="alert">{err}</span> : <span className="field-hint">Type to find a folder. ← and → close and open one.</span>}
        </div>
      </div>
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
