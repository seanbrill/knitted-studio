"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { api, knitFileUrl, type KnitRecord } from "@knitted/core/client";
import { KNIT_SIZES, foldersIn, isInside, nameOf, sizeNamed } from "@knitted/core";
import { Button, Chip, ConfirmDialog, Dialog, EmptyState, Input, Select, SkeletonSection, icons, useToast } from "@knitted/ui";
import { formatBytes, timeAgo, useLive } from "@/lib/hooks";
import { FolderCrumbs, FolderDialogs, FolderList, NewFolderButton, useFolders } from "./Folders";
import { KnitPost } from "./KnitPost";
import { KnitQueue } from "./KnitQueue";
import { TagFilter, ViewBar, layout, useView, type SortBy } from "./Views";
import { AskModelButton, aboutKnit } from "./AskModel";
import { PickBox, SelectionBar, TagDialog, picking, useSelection } from "./Selection";
import { PostDialog } from "./PostDialog";
import { KnitWithComments } from "./Comments";
import { ModelMark } from "./ModelMark";
import { leadOf, useMarks } from "@/lib/agent";

const KNIT_SORTS: SortBy<KnitRecord>[] = [
  { value: "newest", label: "Newest first", key: (k) => k.createdAt, desc: true },
  { value: "oldest", label: "Oldest first", key: (k) => k.createdAt },
  { value: "name", label: "Name, A to Z", key: (k) => k.label },
  { value: "size", label: "Biggest first", key: (k) => k.bytes, desc: true },
];

const { Download, Trash2, AlertTriangle, Copy, FolderInput, MessageSquare, X, Check, Send, Star } = icons;

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

export function KnitsView({ projectId }: { projectId: string }) {
  const toast = useToast();
  const { data: knits, refresh } = useLive(() => api.knit.list(projectId), [projectId]);
  const { data: active } = useLive(() => api.knit.active(projectId), [projectId]);
  // Open comments on each knit, to find the ones with something to do.
  const { data: notes } = useLive(() => api.comments.counts(projectId), [projectId]);
  const noted = (id: string) => notes?.[id] ?? 0;
  const [open, setOpen] = useState<KnitRecord | null>(null);
  // Opening a knit is looking at it: its New badge goes.
  const show = (k: KnitRecord) => { setOpen(k); if (!k.seenAt) void api.knit.seen(k.id).then(refresh, () => {}); };
  const unseen = (knits ?? []).filter((k) => !k.seenAt).length;
  const [onlyNew, setOnlyNew] = useState(false);
  const favorites = (knits ?? []).filter((k) => k.favorite).length;
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const favorite = async (k: KnitRecord, on = !k.favorite) => {
    try { const next = await api.knit.favorite(k.id, on); setOpen((o) => (o?.id === k.id ? next : o)); await refresh(); } catch (e) { toast.problem((e as Error).message); }
  };
  const retag = async (tags: string[]) => { if (!open) return; setOpen(await api.knit.tag(open.id, tags)); await refresh(); };
  const [del, setDel] = useState<KnitRecord | null>(null);
  // Anything knitted after this page opened is new, and gets the signature "stitching in" reveal.
  const [openedAt] = useState(() => Date.now());
  const kit = useFolders(projectId, "knits", knits, { onChanged: refresh });

  const view = useView<KnitRecord>("knits", KNIT_SORTS);
  const [q, setQ] = useState("");
  const [format, setFormat] = useState("all");
  const [kind, setKind] = useState<"all" | "image" | "video">("all");
  const [size, setSize] = useState("all");
  const [tag, setTag] = useState<string | undefined>();
  const [tagText, setTagText] = useState("");
  const formats = useMemo(() => [...new Set((knits ?? []).map((k) => k.format))].sort(), [knits]);
  // The types there are: pictures or videos, and the shapes, in the order the sizes are named.
  const kinds = useMemo(() => new Set((knits ?? []).map((k) => k.kind)), [knits]);
  const sizes = useMemo(() => { const has = new Set((knits ?? []).map((k) => sizeNamed(k.width, k.height) ?? "Other")); return KNIT_SIZES.filter((s) => has.has(s)); }, [knits]);
  // A search or a filter looks in the folder the person is in and every folder inside it.
  const filtering = !!q.trim() || format !== "all" || kind !== "all" || size !== "all" || !!tag || (onlyNew && unseen > 0) || onlyFavorites;
  const here = view.sorted((knits ?? []).filter((k) => (filtering ? isInside(k.folder, kit.here) && k.label.toLowerCase().includes(q.trim().toLowerCase()) && (format === "all" || k.format === format) && (kind === "all" || k.kind === kind) && (size === "all" || (sizeNamed(k.width, k.height) ?? "Other") === size) && (!tag || k.tags.includes(tag)) && (!onlyNew || !unseen || !k.seenAt) && (!onlyFavorites || k.favorite) : k.folder === kit.here)));
  // Batches are kept together only newest first: sorted another way, each knit stands on its own.
  const batched = view.sort === "newest";
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
  const [tagging, setTagging] = useState(false);
  const [bulkDelete, setBulkDelete] = useState(false);
  // What is being posted: the open knit, or the picked ones together.
  const [posting, setPosting] = useState<KnitRecord[] | null>(null);
  const pickedNew = sel.picked.filter((k) => !k.seenAt);
  const pickedAllFavorites = sel.picked.length > 0 && sel.picked.every((k) => k.favorite);
  // A folder downloads as a zip of it and the folders in it, each a folder in the zip.
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
          <TagFilter tags={(knits ?? []).map((k) => k.tags)} value={tag} onChange={setTag} />
          {unseen > 0 && <label className="body-sm" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> Only new ({unseen})</label>}
          {(favorites > 0 || onlyFavorites) && <label className="body-sm" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={onlyFavorites} onChange={(e) => setOnlyFavorites(e.target.checked)} /> Only favourites ({favorites})</label>}
          <ViewBar view={view} what="knits" />
        </div>
      )}
      <SelectionBar sel={sel} total={here.length}>
        <Button size="sm" onClick={() => kit.askMove(sel.picked, `${sel.count} ${sel.count === 1 ? "knit" : "knits"}`)}><FolderInput size={13} aria-hidden /> Move to folder</Button>
        <Button size="sm" onClick={() => setTagging(true)}>Add tag</Button>
        <Button size="sm" onClick={async () => { const on = !pickedAllFavorites; for (const k of sel.picked) await api.knit.favorite(k.id, on); await refresh(); toast(on ? `Added ${sel.count} to your favourites` : `Took ${sel.count} off your favourites`); }}><Star size={13} aria-hidden /> {pickedAllFavorites ? "Take off favourites" : "Add to favourites"}</Button>
        <Button size="sm" onClick={() => setPosting(sel.picked)}><Send size={13} aria-hidden /> Post together</Button>
        <a className="btn btn-secondary btn-sm" href={`/api/projects/${projectId}/knits/zip?ids=${sel.picked.map((k) => k.id).join(",")}`}><Download size={13} aria-hidden /> Download</a>
        {pickedNew.length > 0 && <Button size="sm" onClick={async () => { for (const k of pickedNew) await api.knit.seen(k.id); await refresh(); }}><Check size={13} aria-hidden /> Mark seen</Button>}
        <Button size="sm" variant="danger" onClick={() => setBulkDelete(true)}><Trash2 size={13} aria-hidden /> Delete</Button>
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
                    <li key={k.id} className={`pickable${fresh ? " stitching-in" : ""}`} data-selected={sel.has(k.id)} draggable onDragStart={kit.dragThings(sel.has(k.id) ? sel.picked.map((x) => x.id) : [k.id])}>
                      <PickBox sel={sel} id={k.id} name={k.label} className="pick-box" />
                      <div className="card card-link" style={{ position: "relative", padding: "6px var(--space-3) 6px 6px", display: "grid", gridTemplateColumns: "56px minmax(0, 1fr) auto", gap: "var(--space-3)", alignItems: "center" }}>
                        <button aria-label={`Open ${k.label}${k.seenAt ? "" : ", new"}${k.patternChangedSince ? ", its pattern changed since" : ""}${noted(k.id) ? `, ${noted(k.id)} open comment${noted(k.id) === 1 ? "" : "s"}` : ""}`} onClick={(e) => (picking(e) ? sel.toggle(k.id, e.shiftKey) : show(k))} style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent", border: 0, cursor: "pointer", borderRadius: "var(--radius-md)" }} />
                        <div aria-hidden className="thumb" style={{ width: 56, height: 56, padding: 4 }}>
                          {k.kind === "image" ? <img src={knitFileUrl(k)} alt="" loading="lazy" style={{ display: "block", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <video src={knitFileUrl(k)} muted preload="metadata" style={{ display: "block", maxWidth: "100%", maxHeight: "100%" }} />}
                        </div>
                        <div aria-hidden style={{ minWidth: 0 }}>
                          <p className="label" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.label}</p>
                          <p className="eyebrow" style={{ margin: "2px 0 0", display: "flex", gap: 6, alignItems: "center" }}>{k.format} · {k.width}x{k.height} · {formatBytes(k.bytes)}{warn > 0 && <span title={`${warn} to review`} style={{ color: "var(--danger)" }}><AlertTriangle size={12} aria-hidden /></span>}{noted(k.id) > 0 && <span className="comment-count" title={`${noted(k.id)} open comment${noted(k.id) === 1 ? "" : "s"}`}><MessageSquare size={12} aria-hidden />{noted(k.id)}</span>}{k.patternChangedSince && <span title="Its pattern was changed after this was knitted. Knit it again to bring it up to date." style={{ textTransform: "none", letterSpacing: 0 }}>· pattern changed</span>}</p>
                        </div>
                        <span className="body-sm" style={{ color: "var(--ink-muted)", whiteSpace: "nowrap", display: "flex", gap: 8, alignItems: "center", position: "relative", zIndex: 2 }}><span aria-hidden style={{ display: "contents" }}>{!k.seenAt && <span className="new-badge in-row">New</span>}{timeAgo(k.createdAt)}</span><FavoriteStar k={k} onToggle={favorite} inRow /></span>
                        <ModelMark mark={marks.get(k.id)} lead={lead === k.id} />
                      </div>
                    </li>
                  );
                  return (
                    <li key={k.id} className={`pickable${fresh ? " stitching-in" : ""}`} data-selected={sel.has(k.id)} draggable onDragStart={kit.dragThings(sel.has(k.id) ? sel.picked.map((x) => x.id) : [k.id])}>
                      <PickBox sel={sel} id={k.id} name={k.label} className="pick-box" />
                      <div className="card card-link" style={{ position: "relative", height: "100%", padding: "var(--space-2)" }}>
                        <button aria-label={`Open ${k.label}${k.seenAt ? "" : ", new"}${k.patternChangedSince ? ", its pattern changed since" : ""}${noted(k.id) ? `, ${noted(k.id)} open comment${noted(k.id) === 1 ? "" : "s"}` : ""}`} onClick={(e) => (picking(e) ? sel.toggle(k.id, e.shiftKey) : show(k))} style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent", border: 0, cursor: "pointer", borderRadius: "var(--radius-md)" }} />
                        {!k.seenAt && <span aria-hidden className="new-badge">New</span>}
                        {/* On the card's 4:5 mat, as a pattern's card has it, so a row of knits lines up whatever their sizes. */}
                        <div aria-hidden className="thumb" style={{ padding: "var(--space-2)" }}>
                          <div style={{ width: k.width / k.height > 0.8 ? "100%" : `${(k.width / k.height / 0.8) * 100}%`, aspectRatio: `${k.width} / ${k.height}`, borderRadius: "var(--radius-sm)", overflow: "hidden", boxShadow: "0 1px 4px rgba(23,17,11,.18)" }}>
                            {k.kind === "image" ? <img src={knitFileUrl(k)} alt="" loading="lazy" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} /> : <video src={knitFileUrl(k)} muted preload="metadata" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />}
                          </div>
                        </div>
                        <p className="label" aria-hidden style={{ margin: "var(--space-2) 0 0", paddingRight: 30, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.label}</p>
                        <p className="eyebrow" aria-hidden style={{ margin: "2px 0 0", display: "flex", gap: 6, alignItems: "center" }}>{k.format} · {k.width}x{k.height} · {formatBytes(k.bytes)}{warn > 0 && <span title={`${warn} to review`} style={{ color: "var(--danger)" }}><AlertTriangle size={12} aria-hidden /></span>}{noted(k.id) > 0 && <span className="comment-count" title={`${noted(k.id)} open comment${noted(k.id) === 1 ? "" : "s"}`}><MessageSquare size={12} aria-hidden />{noted(k.id)}</span>}{k.patternChangedSince && <span title="Its pattern was changed after this was knitted. Knit it again to bring it up to date." style={{ textTransform: "none", letterSpacing: 0 }}>· pattern changed</span>}</p>
                        <FavoriteStar k={k} onToggle={favorite} />
                        <ModelMark mark={marks.get(k.id)} lead={lead === k.id} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} wide title={open?.label ?? "Knit"}
        actions={open && (<>
          <Button variant="ghost" onClick={() => { setDel(open); setOpen(null); }}><Trash2 size={14} aria-hidden /> Delete</Button>
          <Button aria-pressed={open.favorite} tip={open.favorite ? "One of your favourites. Press to take it off." : "Find it again with Only favourites."} onClick={() => void favorite(open)}><Star size={14} fill={open.favorite ? "currentColor" : "none"} aria-hidden /> Favourite</Button>
          <Button onClick={() => { kit.askMove([open], open.label); setOpen(null); }}><FolderInput size={14} aria-hidden /> Move to folder</Button>
          <AskModelButton about={aboutKnit(open)} />
          <Button onClick={() => { setPosting([open]); setOpen(null); }}><Send size={14} aria-hidden /> Post</Button>
          {open.kind === "image" && <Button onClick={async () => { try { const blob = await (await fetch(knitFileUrl(open))).blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); toast("Copied. Paste it anywhere."); } catch { toast("Your browser would not copy that. Use Download instead."); } }}><Copy size={14} aria-hidden /> Copy</Button>}
          <a className="btn btn-primary" href={knitFileUrl(open, true)}><Download size={14} aria-hidden /> Download</a>
        </>)}>
        {open && (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <KnitWithComments key={open.id} knit={open} src={knitFileUrl(open)} />
            <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{open.format.toUpperCase()}, {open.width}x{open.height}, {formatBytes(open.bytes)}, knitted {timeAgo(open.createdAt)}. {open.patternId && <Link className="link" href={`/projects/${projectId}/patterns/${open.patternId}`}>Open the pattern</Link>}</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {open.tags.map((t) => <Chip key={t}>{t}<button className="icon-btn" style={{ width: 18, height: 18 }} aria-label={`Remove tag ${t}`} onClick={() => void retag(open.tags.filter((x) => x !== t))}><X size={11} /></button></Chip>)}
              <div style={{ width: 180 }}><Input aria-label="Add a tag" value={tagText} placeholder="Add a tag" onChange={(e) => setTagText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tagText.trim()) { void retag([...open.tags, tagText]); setTagText(""); } }} /></div>
            </div>
            <KnitPost knit={open} onChanged={(k) => { setOpen(k); void refresh(); }} />
            {(open.report.issues ?? []).length > 0 && <ul style={{ margin: 0, paddingLeft: 18 }}>{open.report.issues!.map((i, n) => <li key={n} className="body-sm">{i.message}</li>)}</ul>}
          </div>
        )}
      </Dialog>
      <TagDialog open={tagging} onOpenChange={setTagging} what={`${sel.count} ${sel.count === 1 ? "knit" : "knits"}`} onTag={async (t) => { for (const k of sel.picked) await api.knit.tag(k.id, [...k.tags, t]); await refresh(); toast(`Tagged ${t}`); }} />
      <ConfirmDialog open={bulkDelete} onOpenChange={setBulkDelete} title={`Delete ${sel.count} ${sel.count === 1 ? "knit" : "knits"}?`} description="The files are removed from disk. You can knit them again from their patterns." confirmLabel="Delete files"
        onConfirm={async () => { for (const k of sel.picked) await api.knit.remove(k.id); sel.clear(); await refresh(); toast("Deleted"); }} />
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete this knit?" description="The file is removed from disk. You can knit it again from the pattern." confirmLabel="Delete file" onConfirm={async () => { await api.knit.remove(del!.id); await refresh(); toast("Deleted"); }} />
      <FolderDialogs kit={kit} />
      {posting && <PostDialog key={posting.map((k) => k.id).join()} projectId={projectId} knits={posting} open onOpenChange={(o) => !o && setPosting(null)} />}
    </div>
  );
}
