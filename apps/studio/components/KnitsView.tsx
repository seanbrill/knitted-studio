"use client";

import { useMemo, useState } from "react";
import { api, knitFileUrl, type KnitRecord } from "@knitted/core/client";
import { KNIT_SIZES, foldersIn, isInside, nameOf, sizeNamed } from "@knitted/core";
import { Button, ConfirmDialog, ContextMenu, EmptyState, IconButton, Input, Menu, Select, SkeletonSection, icons, useToast, type MenuItems } from "@knitted/ui";
import { formatBytes, timeAgo, useLive } from "@/lib/hooks";
import { FolderCrumbs, FolderDialogs, FolderList, NewFolderButton, useFolders } from "./Folders";
import { KnitQueue } from "./KnitQueue";
import { KnitView, formatName, saveHref } from "./KnitView";
import { AskModelDialog, aboutKnit } from "./AskModel";
import { TagFilter, ViewBar, layout, useView, type SortBy } from "./Views";
import { PickBox, SelectionBar, TagDialog, picking, tagWords, useListKeys, useSelection } from "./Selection";
import { keyText } from "./Shortcuts";
import { PostDialog } from "./PostDialog";
import { ModelMark } from "./ModelMark";
import { leadOf, useMarks } from "@/lib/agent";

const KNIT_SORTS: SortBy<KnitRecord>[] = [
  { value: "newest", label: "Made", key: (k) => k.createdAt, desc: true, ways: ["newest first", "oldest first"] },
  { value: "name", label: "Name", key: (k) => k.label, ways: ["A to Z", "Z to A"] },
  { value: "size", label: "Size on disk", key: (k) => k.bytes, desc: true, ways: ["biggest first", "smallest first"] },
];

const { Download, Trash2, AlertTriangle, FolderInput, MessageSquare, Check, Send, Star, Copy, Sparkles, Maximize2, MoreHorizontal, Tag } = icons;

/** A knit's star: press to make it a favourite, again to take it off. */
function FavoriteStar({ k, onToggle, inRow }: { k: KnitRecord; onToggle: (k: KnitRecord) => void; inRow?: boolean }) {
  return (
    <button type="button" className={`knit-star${inRow ? " in-row" : ""}`} aria-pressed={k.favorite} aria-label={`Favourite ${k.label}`} title={k.favorite ? "A favourite. Press to take it off." : "Add to your favourites"} onClick={() => onToggle(k)}>
      <Star size={16} fill={k.favorite ? "currentColor" : "none"} aria-hidden />
    </button>
  );
}

// A size by what it is for, so a reel is easy to find: a Story-shaped video.
const SIZE_LABELS: Record<string, string> = {
  Story: "Story 9:16 (Stories, Reels, TikTok, Shorts)",
  Post: "Post 4:5",
  Square: "Square 1:1",
  Landscape: "Landscape 16:9 (YouTube)",
  Banner: "Banner",
  Other: "Other sizes",
};

/**
 * A knit's chips under its name when it has more than one file: its versions (a new one in
 * ember, with when), its other formats, each with its scale ("+ PNG 2x"), and a pattern changed
 * since. Listing every file, which version each one is.
 */
type KnitChip = { text: string; tone?: "new" | "warn" };
function knitChips(k: KnitRecord, every: boolean): KnitChip[] {
  const n = k.versions ?? 1, out: KnitChip[] = [];
  if (every) { if (n > 1) out.push({ text: `Version ${k.versionNo} of ${n}` }); }
  else {
    if (n > 1) out.push(k.versionNo !== n ? { text: `Version ${k.versionNo} of ${n}` } : !k.seenAt ? { text: `Version ${n}, ${timeAgo(k.createdAt)}`, tone: "new" } : { text: `${n} versions` });
    const more = (k.formats ?? []).slice(1);
    if (more.length) out.push({ text: `+ ${more.map((f) => `${formatName({ ...f, scale: 1, fps: undefined })} ${f.scale}x${f.fps ? ` ${f.fps} fps` : ""}`).join(", ")}` });
  }
  if (k.patternChangedSince) out.push({ text: "pattern changed since", tone: "warn" });
  return out;
}
const Chips = ({ chips, inline }: { chips: KnitChip[]; inline?: boolean }) => chips.length
  ? (inline ? <span className="knit-chips">{chips.map((c) => <span key={c.text} className="knit-chip" data-tone={c.tone}>{c.text}</span>)}</span>
    : <p className="knit-chips" aria-hidden>{chips.map((c) => <span key={c.text} className="knit-chip" data-tone={c.tone}>{c.text}</span>)}</p>)
  : null;

export function KnitsView({ projectId }: { projectId: string }) {
  const toast = useToast();
  // Each knit once, as the file shown for it; or, asked, every file there is.
  const [every, setEvery] = useState(false);
  const { data: knits, refresh } = useLive(() => api.knit.list(projectId, { every }), [projectId, every]);
  const { data: active } = useLive(() => api.knit.active(projectId), [projectId]);
  // Open comments on each knit, to find the ones with something to do.
  const { data: notes } = useLive(() => api.comments.counts(projectId), [projectId]);
  const noted = (id: string) => notes?.[id] ?? 0;
  // The knit open, followed through a new version coming in while it is: by its knit, not its file.
  const [opened, setOpened] = useState<KnitRecord | null>(null);
  const open = opened && ((knits ?? []).find((k) => k.id === opened.id) ?? (!every && opened.unit ? (knits ?? []).find((k) => k.unit === opened.unit) : undefined) ?? opened);
  const setOpen = setOpened;
  // Opening a knit is looking at it: its New badge goes.
  const show = (k: KnitRecord) => { setOpen(k); if (!k.seenAt) void api.knit.seen(k.id).then(refresh, () => {}); };
  const unseen = (knits ?? []).filter((k) => !k.seenAt).length;
  const [onlyNew, setOnlyNew] = useState(false);
  const favorites = (knits ?? []).filter((k) => k.favorite).length;
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const favorite = async (k: KnitRecord, on = !k.favorite) => {
    try { await api.knit.favorite(k.id, on); await refresh(); } catch (e) { toast.problem((e as Error).message); }
  };
  // Anything knitted after this page opened is new, and gets the signature "stitching in" reveal.
  const [openedAt] = useState(() => Date.now());
  const kit = useFolders(projectId, "knits", knits, { onChanged: refresh, peek: (t) => { const k = t as KnitRecord; return k.kind === "image" ? knitFileUrl(k) : null; }, zipOf: (f) => `/api/projects/${projectId}/knits/zip?folder=${encodeURIComponent(f)}` });

  const view = useView<KnitRecord>("knits", KNIT_SORTS);
  const [q, setQ] = useState("");
  const [format, setFormat] = useState("all");
  const [kind, setKind] = useState<"all" | "image" | "video">("all");
  const [size, setSize] = useState("all");
  const [tag, setTag] = useState<string | undefined>();
  const formats = useMemo(() => [...new Set((knits ?? []).map((k) => k.format))].sort(), [knits]);
  // The types there are: pictures or videos, and the shapes, in the order the sizes are named.
  const kinds = useMemo(() => new Set((knits ?? []).map((k) => k.kind)), [knits]);
  const sizes = useMemo(() => { const has = new Set((knits ?? []).map((k) => sizeNamed(k.width, k.height) ?? "Other")); return KNIT_SIZES.filter((s) => has.has(s)); }, [knits]);
  // A search or a filter looks in the folder the person is in and every folder inside it.
  const filtering = !!q.trim() || format !== "all" || kind !== "all" || size !== "all" || !!tag || (onlyNew && unseen > 0) || onlyFavorites || every;
  const here = view.sorted((knits ?? []).filter((k) => (filtering ? isInside(k.folder, kit.here) && k.label.toLowerCase().includes(q.trim().toLowerCase()) && (format === "all" || k.format === format) && (kind === "all" || k.kind === kind) && (size === "all" || (sizeNamed(k.width, k.height) ?? "Other") === size) && (!tag || k.tags.includes(tag)) && (!onlyNew || !unseen || !k.seenAt) && (!onlyFavorites || k.favorite) : k.folder === kit.here)));
  // Batches are kept together only newest first: sorted another way, each knit stands on its own.
  const batched = view.sort === "newest" && !view.reverse;
  // A batch of several is a set under its own header. The knits between batches share one grid, keyed by the
  // batch above them, so a new knit at the top leaves the rest of the grid as it is.
  const inBatch = new Map<string, number>();
  for (const k of here) if (k.batchId) inBatch.set(k.batchId, (inBatch.get(k.batchId) ?? 0) + 1);
  const groups: { key: string; batch: string | null; knits: KnitRecord[] }[] = [];
  for (const k of here) {
    const batch = batched && k.batchId && (inBatch.get(k.batchId) ?? 0) > 1 ? k.batchId : null;
    const last = groups[groups.length - 1];
    const group = batch ? groups.find((g) => g.batch === batch) : last && !last.batch ? last : undefined;
    if (group) group.knits.push(k);
    else groups.push({ key: batch ?? `after-${last?.batch ?? "top"}`, batch, knits: [k] });
  }
  const sel = useSelection(here);
  // Knits a model is filing: outlined here as they go, and where they land.
  const marks = useMarks((w) => w.thingIds);
  const lead = leadOf(marks);
  // What a dialog is about: the picked knits, or the one whose menu it came from.
  const [tagFor, setTagFor] = useState<KnitRecord[] | null>(null);
  const [deleteFor, setDeleteFor] = useState<KnitRecord[] | null>(null);
  const [asking, setAsking] = useState<KnitRecord | null>(null);
  // What is being posted: the open knit, or the picked ones together.
  const [posting, setPosting] = useState<KnitRecord[] | null>(null);
  const pickedNew = sel.picked.filter((k) => !k.seenAt);
  const pickedAllFavorites = sel.picked.length > 0 && sel.picked.every((k) => k.favorite);
  // What the keys and the menus do, on one knit or on the ones picked.
  const act = {
    move: (them: KnitRecord[]) => kit.askMove(them, them.length > 1 ? `${them.length} knits` : them[0]!.label),
    tag: (them: KnitRecord[]) => setTagFor(them),
    favourite: async (them: KnitRecord[]) => {
      const on = !them.every((x) => x.favorite);
      for (const x of them) await api.knit.favorite(x.id, on);
      await refresh();
      toast(them.length > 1 ? (on ? `Added ${them.length} to your favourites` : `Took ${them.length} off your favourites`) : on ? `${them[0]!.label} is a favourite` : `Took ${them[0]!.label} off your favourites`);
    },
    delete: (them: KnitRecord[]) => setDeleteFor(them),
  };
  useListKeys(here, sel, { move: act.move, tag: act.tag, favourite: (t) => void act.favourite(t), delete: act.delete });
  /**
   * A knit's menu, the same from its ... button and a right-click. On one of several picked, it
   * acts on all of them and says so; what works on one only, like Open, acts on the one clicked.
   */
  const menuFor = (k: KnitRecord): MenuItems => {
    const many = sel.has(k.id) && sel.count > 1 ? sel.picked : null;
    const them = many ?? [k];
    const n = them.length;
    const caption = k.post.caption ? [k.post.caption, (k.post.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n") : "";
    const allFav = them.every((x) => x.favorite);
    const deep = them.some((x) => (x.versions ?? 1) > 1 || (x.formats?.length ?? 1) > 1);
    return [
      { label: "Open", icon: <Maximize2 size={14} aria-hidden />, onSelect: () => show(k) },
      { label: many ? `Post ${n} together` : "Post", icon: <Send size={14} aria-hidden />, onSelect: () => setPosting(them) },
      ...(many ? [] : [
        { label: "Copy the caption", icon: <Copy size={14} aria-hidden />, disabled: !caption, hint: caption ? undefined : "It has no caption yet: open it to write one", onSelect: async () => { await navigator.clipboard.writeText(caption); toast("Caption and hashtags copied."); } },
        { label: "Ask your model", icon: <Sparkles size={14} aria-hidden />, onSelect: () => setAsking(k) },
      ]),
      "separator",
      { label: many ? `Move ${n} to folder` : "Move to folder", icon: <FolderInput size={14} aria-hidden />, shortcut: "M", onSelect: () => act.move(them) },
      { label: many ? `Tag ${n}` : "Add a tag", icon: <Tag size={14} aria-hidden />, shortcut: "T", onSelect: () => act.tag(them) },
      { label: allFav ? (many ? `Take ${n} off favourites` : "Take off favourites") : (many ? `Add ${n} to favourites` : "Favourite"), icon: <Star size={14} aria-hidden />, shortcut: "F", onSelect: () => act.favourite(them) },
      { label: many ? `Download ${n}, as a zip` : "Download", icon: <Download size={14} aria-hidden />, onSelect: () => saveHref(many ? `/api/projects/${projectId}/knits/zip?ids=${them.map((x) => x.id).join(",")}` : knitFileUrl(k, true)) },
      "separator",
      { label: every ? (many ? `Delete ${n} files` : "Delete this file") : many ? `Delete ${n} knits` : deep ? "Delete, every version" : "Delete", icon: <Trash2 size={14} aria-hidden />, danger: true, shortcut: keyText(["Delete"]), onSelect: () => act.delete(them) },
    ];
  };
  const more = (k: KnitRecord, inRow?: boolean) => <Menu trigger={<IconButton label={`Actions for ${k.label}`} className={`card-more${inRow ? " in-row" : ""}`}><MoreHorizontal size={16} /></IconButton>} items={menuFor(k)} />;
  // A folder downloads as a zip of it and the folders in it, each a folder in the zip.
  const nameIn = (folder: string) => ["Knits", ...(folder ? folder.split("/") : [])].join(" / ");
  const anything = kit.here ? kit.countIn(kit.here) > 0 : (knits ?? []).length > 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        <h2 className="h2">Knits</h2>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
          {unseen > 0 && <Button variant="ghost" tip="Take the New badge off every knit in this project" onClick={async () => { await api.knit.allSeen(projectId); setOnlyNew(false); await refresh(); }}><Check size={14} aria-hidden /> Mark all seen</Button>}
          <NewFolderButton kit={kit} />
          {anything && (kit.here
            ? <a className="btn btn-secondary" href={`/api/projects/${projectId}/knits/zip?folder=${encodeURIComponent(kit.here)}`}><Download size={14} aria-hidden /> Download folder</a>
            : <a className="btn btn-secondary" href={`/api/projects/${projectId}/knits/zip`}><Download size={14} aria-hidden /> Download all</a>)}
        </div>
      </div>
      <FolderCrumbs kit={kit} />

      <KnitQueue jobs={active ?? []} />

      {(knits?.length ?? 0) > 0 && (
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
          <Input aria-label={kit.here ? `Search ${nameOf(kit.here)} and the folders in it` : "Search knits"} placeholder="Search knits" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          {(kinds.size > 1 || kind !== "all") && <div style={{ minWidth: 150 }}><Select aria-label="Pictures or videos" value={kind} onValueChange={(x) => setKind(x as typeof kind)} options={[{ value: "all", label: "Pictures and videos" }, { value: "image", label: "Pictures" }, { value: "video", label: "Videos" }]} /></div>}
          {(sizes.length > 1 || size !== "all") && <div style={{ minWidth: 150 }}><Select aria-label="Size" value={size} onValueChange={setSize} options={[{ value: "all", label: "Every size" }, ...sizes.map((s) => ({ value: s, label: SIZE_LABELS[s] ?? s }))]} /></div>}
          <div style={{ minWidth: 150 }}><Select aria-label="Format" value={format} onValueChange={setFormat} options={[{ value: "all", label: "Every format" }, ...formats.map((f) => ({ value: f, label: f.toUpperCase() }))]} /></div>
          <TagFilter tags={(knits ?? []).map((k) => k.tags)} value={tag} onChange={setTag} show={0} />
          {unseen > 0 && <label className="body-sm" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> Only new ({unseen})</label>}
          {(favorites > 0 || onlyFavorites) && <label className="body-sm" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={onlyFavorites} onChange={(e) => setOnlyFavorites(e.target.checked)} /> Only favourites ({favorites})</label>}
          <label className="body-sm" style={{ display: "flex", gap: 6, alignItems: "center" }} title="Each knit shows once, as its newest version. This shows every version and format, each as its own card."><input type="checkbox" checked={every} onChange={(e) => setEvery(e.target.checked)} /> Every version</label>
          <ViewBar view={view} what="knits" />
        </div>
      )}
      <SelectionBar sel={sel} total={here.length}>
        <Button size="sm" onClick={() => kit.askMove(sel.picked, `${sel.count} ${sel.count === 1 ? "knit" : "knits"}`)}><FolderInput size={13} aria-hidden /> Move to folder</Button>
        <Button size="sm" onClick={() => setTagFor(sel.picked)}>Add tag</Button>
        <Button size="sm" onClick={async () => { const on = !pickedAllFavorites; for (const k of sel.picked) await api.knit.favorite(k.id, on); await refresh(); toast(on ? `Added ${sel.count} to your favourites` : `Took ${sel.count} off your favourites`); }}><Star size={13} aria-hidden /> {pickedAllFavorites ? "Take off favourites" : "Add to favourites"}</Button>
        <Button size="sm" onClick={() => setPosting(sel.picked)}><Send size={13} aria-hidden /> Post together</Button>
        <a className="btn btn-secondary btn-sm" href={`/api/projects/${projectId}/knits/zip?ids=${sel.picked.map((k) => k.id).join(",")}`}><Download size={13} aria-hidden /> Download</a>
        {pickedNew.length > 0 && <Button size="sm" onClick={async () => { for (const k of pickedNew) await api.knit.seen(k.id); await refresh(); }}><Check size={13} aria-hidden /> Mark seen</Button>}
        <Button size="sm" variant="danger" onClick={() => setDeleteFor(sel.picked)}><Trash2 size={13} aria-hidden /> Delete</Button>
      </SelectionBar>
      {filtering ? (kit.here && <p className="body-sm" style={{ margin: "0 0 var(--space-3)", color: "var(--ink-muted)" }}>Looking in {nameOf(kit.here)} and the folders in it.</p>) : <FolderList kit={kit} />}
      {!knits || !kit.folders ? <SkeletonSection filters={!knits} tiles={kit.folders ? 0 : 3} min={190} list={view.mode === "list"} /> : knits.length === 0 && kit.folders.length === 0 ? (
        <EmptyState title="Nothing knitted yet" body="Open a pattern and press Knit. Everything you make from this project shows up here." />
      ) : here.length === 0 ? (
        filtering ? (onlyFavorites && !favorites ? <EmptyState title="No favourites yet" body="Press the star on a knit you like, and it shows here." /> : <EmptyState title="Nothing matches" body={onlyFavorites ? "None of your favourites matches. Try another search or filter." : "Try another search or filter."} />) : kit.here && !kit.gone && foldersIn(kit.folders, kit.here).length === 0 && <EmptyState title={`Nothing in ${nameOf(kit.here)} yet`} body="Drag knits onto this folder, or open one and choose Move to folder." />
      ) : (
        <div style={{ display: "grid", gap: "var(--space-8)" }}>
          {groups.map(({ key, batch, knits: group }) => (
            <section key={key} aria-label={batch ? `Batch of ${group.length}` : undefined}>
              {batch && (
                <h3 className="eyebrow" style={{ marginBottom: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  Batch of {group.length} · {timeAgo(group[0].createdAt)}
                  <a className="link" href={`/api/projects/${projectId}/knits/zip?batch=${batch}`}>Download batch</a>
                  <button type="button" className="link" onClick={() => kit.askMove(group, `the batch of ${group.length}`)}>Move batch</button>
                </h3>
              )}
              <ul className="arrive-list" style={layout(view.mode, 190)}>
                {group.map((k) => {
                  const fresh = Date.parse(k.createdAt) > openedAt;
                  const warn = (k.report.issues ?? []).filter((i) => i.level === "warning").length;
                  if (view.mode === "list") return (
                    <li key={k.id} data-thing={k.id} className={`pickable${fresh ? " stitching-in" : ""}`} data-selected={sel.has(k.id)} draggable onDragStart={kit.dragThings(sel.has(k.id) ? sel.picked.map((x) => x.id) : [k.id])}>
                      <PickBox sel={sel} id={k.id} name={k.label} className="pick-box" />
                      <ContextMenu items={menuFor(k)}>
                      <div className="card card-link" style={{ position: "relative", padding: "6px var(--space-3) 6px 6px", display: "grid", gridTemplateColumns: "56px minmax(0, 1fr) auto", gap: "var(--space-3)", alignItems: "center" }}>
                        <button aria-label={`Open ${k.label}${k.seenAt ? "" : (k.versions ?? 1) > 1 ? ", a new version" : ", new"}${(k.versions ?? 1) > 1 ? `, ${k.versions} versions` : ""}${k.patternChangedSince ? ", its pattern changed since" : ""}${noted(k.id) ? `, ${noted(k.id)} open comment${noted(k.id) === 1 ? "" : "s"}` : ""}`} onClick={(e) => (picking(e) ? sel.toggle(k.id, e.shiftKey) : show(k))} style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent", border: 0, cursor: "pointer", borderRadius: "var(--radius-md)" }} />
                        <div aria-hidden className="thumb" style={{ width: 56, height: 56, padding: 4 }}>
                          {k.kind === "image" ? <img src={knitFileUrl(k)} alt="" loading="lazy" style={{ display: "block", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <video src={knitFileUrl(k)} muted preload="metadata" style={{ display: "block", maxWidth: "100%", maxHeight: "100%" }} />}
                        </div>
                        <div aria-hidden style={{ minWidth: 0 }}>
                          <p className="label" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.label}</p>
                          <p className="eyebrow knit-meta"><span className="knit-meta-text">{k.format} · {k.width}x{k.height} · {formatBytes(k.bytes)}</span>{warn > 0 && <span title={`${warn} to review`} style={{ color: "var(--danger)", display: "inline-flex" }}><AlertTriangle size={12} aria-hidden /></span>}{noted(k.id) > 0 && <span className="comment-count" title={`${noted(k.id)} open comment${noted(k.id) === 1 ? "" : "s"}`}><MessageSquare size={12} aria-hidden />{noted(k.id)}</span>}<Chips chips={knitChips(k, every)} inline /></p>
                        </div>
                        <span className="body-sm" style={{ color: "var(--ink-muted)", whiteSpace: "nowrap", display: "flex", gap: 8, alignItems: "center", position: "relative", zIndex: 2 }}><span aria-hidden style={{ display: "contents" }}>{!k.seenAt && <span className="new-badge in-row">New</span>}{timeAgo(k.createdAt)}</span><FavoriteStar k={k} onToggle={favorite} inRow />{more(k, true)}</span>
                        <ModelMark mark={marks.get(k.id)} lead={lead === k.id} />
                      </div>
                      </ContextMenu>
                    </li>
                  );
                  return (
                    <li key={k.id} data-thing={k.id} className={`pickable${fresh ? " stitching-in" : ""}`} data-selected={sel.has(k.id)} draggable onDragStart={kit.dragThings(sel.has(k.id) ? sel.picked.map((x) => x.id) : [k.id])}>
                      <PickBox sel={sel} id={k.id} name={k.label} className="pick-box" />
                      <ContextMenu items={menuFor(k)}>
                      <div className={`card card-link${(k.versions ?? 1) > 1 ? " knit-stack" : ""}`} style={{ position: "relative", height: "100%", padding: "var(--space-2)" }}>
                        <button aria-label={`Open ${k.label}${k.seenAt ? "" : (k.versions ?? 1) > 1 ? ", a new version" : ", new"}${(k.versions ?? 1) > 1 ? `, ${k.versions} versions` : ""}${k.patternChangedSince ? ", its pattern changed since" : ""}${noted(k.id) ? `, ${noted(k.id)} open comment${noted(k.id) === 1 ? "" : "s"}` : ""}`} onClick={(e) => (picking(e) ? sel.toggle(k.id, e.shiftKey) : show(k))} style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent", border: 0, cursor: "pointer", borderRadius: "var(--radius-md)" }} />
                        {!k.seenAt && <span aria-hidden className="new-badge">{(k.versions ?? 1) > 1 ? "New version" : "New"}</span>}
                        {/* On the card's 4:5 mat, as a pattern's card has it, so a row of knits lines up whatever their sizes. */}
                        <div aria-hidden className="thumb" style={{ padding: "var(--space-2)" }}>
                          <div style={{ width: k.width / k.height > 0.8 ? "100%" : `${(k.width / k.height / 0.8) * 100}%`, aspectRatio: `${k.width} / ${k.height}`, borderRadius: "var(--radius-sm)", overflow: "hidden", boxShadow: "0 1px 4px rgba(23,17,11,.18)" }}>
                            {k.kind === "image" ? <img src={knitFileUrl(k)} alt="" loading="lazy" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} /> : <video src={knitFileUrl(k)} muted preload="metadata" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />}
                          </div>
                        </div>
                        <p className="label" aria-hidden style={{ margin: "var(--space-2) 0 0", paddingRight: 30, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.label}</p>
                        <p className="eyebrow knit-meta" aria-hidden><span className="knit-meta-text">{k.format} · {k.width}x{k.height} · {formatBytes(k.bytes)}</span>{warn > 0 && <span title={`${warn} to review`} style={{ color: "var(--danger)", display: "inline-flex" }}><AlertTriangle size={12} aria-hidden /></span>}{noted(k.id) > 0 && <span className="comment-count" title={`${noted(k.id)} open comment${noted(k.id) === 1 ? "" : "s"}`}><MessageSquare size={12} aria-hidden />{noted(k.id)}</span>}</p>
                        <Chips chips={knitChips(k, every)} />
                        <FavoriteStar k={k} onToggle={favorite} />
                        {more(k)}
                        <ModelMark mark={marks.get(k.id)} lead={lead === k.id} />
                      </div>
                      </ContextMenu>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {open && <KnitView knit={open} here={here} onOpen={show} onClose={() => setOpen(null)} onChanged={() => void refresh()}
        onMove={(k) => { kit.askMove([k], k.label); setOpen(null); }} onPost={(k) => setPosting([k])} onFavorite={(k) => void favorite(k)} />}
      <TagDialog open={!!tagFor} onOpenChange={(o) => !o && setTagFor(null)} what={tagFor?.length === 1 ? tagFor[0]!.label : `${tagFor?.length ?? 0} knits`} where="Knits"
        items={tagFor ?? []} known={(knits ?? []).map((k) => k.tags)} pics={(tagFor ?? []).map((k) => kit.peekOf(k)).filter((x): x is string => !!x)}
        onSave={async (id, tags) => { await api.knit.tag(id, tags); }} onDone={async (a, r) => { await refresh(); toast(tagWords(a, r)); }} />
      {(() => {
        const them = deleteFor ?? [];
        const n = them.length;
        const one = n === 1 ? them[0]! : null;
        const deep = them.some((k) => (k.versions ?? 1) > 1 || (k.formats?.length ?? 1) > 1);
        return (
          <ConfirmDialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}
            title={one ? `Delete ${one.label}?` : every ? `Delete ${n} files?` : `Delete ${n} knits?`}
            sub={one ? [nameIn(one.folder), ...(every ? [formatName(one)] : [])].join(" · ") : undefined}
            description={every ? `${n === 1 ? "The file is" : "Each file picked is"} removed from disk. Where it was the one shown for its knit, the newest one left is shown.` : `${deep ? `Every version and format of ${n === 1 ? "it" : "each"} goes. ` : ""}The files are removed from disk. You can knit ${n === 1 ? "it" : "them"} again from ${n === 1 ? "its pattern" : "their patterns"}.`}
            confirmLabel={every ? (n === 1 ? "Delete the file" : `Delete ${n} files`) : n === 1 ? (deep ? "Delete every version" : "Delete the knit") : `Delete ${n} knits`}
            onConfirm={async () => { for (const k of them) await api.knit.remove(k.id, every ? "file" : "all"); if (them.some((k) => sel.has(k.id))) sel.clear(); await refresh(); toast("Deleted"); }} />
        );
      })()}
      <AskModelDialog about={asking ? aboutKnit(asking) : null} onOpenChange={(o) => !o && setAsking(null)} />
      <FolderDialogs kit={kit} />
      {posting && <PostDialog key={posting.map((k) => k.id).join()} projectId={projectId} knits={posting} open onOpenChange={(o) => !o && setPosting(null)} />}
    </div>
  );
}
