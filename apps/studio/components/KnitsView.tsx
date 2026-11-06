"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { api, knitFileUrl, type KnitRecord, type JobItem } from "@knitted/core/client";
import { foldersIn, isInside, nameOf } from "@knitted/core";
import { Button, ConfirmDialog, Dialog, EmptyState, Input, Select, Skeleton, StitchProgress, icons, useToast } from "@knitted/ui";
import { formatBytes, timeAgo, useLive } from "@/lib/hooks";
import { FolderCrumbs, FolderDialogs, FolderList, NewFolderButton, useFolders } from "./Folders";
import { ViewBar, layout, useView, type SortBy } from "./Views";

const KNIT_SORTS: SortBy<KnitRecord>[] = [
  { value: "newest", label: "Newest first", key: (k) => k.createdAt, desc: true },
  { value: "oldest", label: "Oldest first", key: (k) => k.createdAt },
  { value: "name", label: "Name, A to Z", key: (k) => k.label },
  { value: "size", label: "Biggest first", key: (k) => k.bytes, desc: true },
];

const { Download, Trash2, AlertTriangle, Copy, FolderInput } = icons;

export function KnitsView({ projectId }: { projectId: string }) {
  const toast = useToast();
  const { data: knits, refresh } = useLive(() => api.knit.list(projectId), [projectId]);
  const { data: jobs } = useLive(() => fetch(`/api/projects/${projectId}/jobs`).then((r) => r.json() as Promise<JobItem[]>), [projectId]);
  const [open, setOpen] = useState<KnitRecord | null>(null);
  const [del, setDel] = useState<KnitRecord | null>(null);
  // Anything knitted after this page opened is new, and gets the signature "stitching in" reveal.
  const [openedAt] = useState(() => Date.now());
  const kit = useFolders(projectId, "knits", knits, { onChanged: refresh });

  const active = (jobs ?? []).filter((j) => j.kind === "knit" && (j.status === "running" || j.status === "queued"));
  const view = useView<KnitRecord>("knits", KNIT_SORTS);
  const [q, setQ] = useState("");
  const [format, setFormat] = useState("all");
  const formats = useMemo(() => [...new Set((knits ?? []).map((k) => k.format))].sort(), [knits]);
  // A search or a format looks in the folder the person is in and every folder inside it.
  const filtering = !!q.trim() || format !== "all";
  const here = view.sorted((knits ?? []).filter((k) => (filtering ? isInside(k.folder, kit.here) && k.label.toLowerCase().includes(q.trim().toLowerCase()) && (format === "all" || k.format === format) : k.folder === kit.here)));
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
  // A folder downloads as a zip of it and the folders in it, each a folder in the zip.
  const anything = kit.here ? kit.countIn(kit.here) > 0 : (knits ?? []).length > 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        <h2 className="h2">Knits</h2>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <NewFolderButton kit={kit} />
          {anything && (kit.here
            ? <a className="btn btn-secondary" href={`/api/projects/${projectId}/knits/zip?folder=${encodeURIComponent(kit.here)}`}><Download size={14} aria-hidden /> Download folder</a>
            : <a className="btn btn-secondary" href={`/api/projects/${projectId}/knits/zip`}><Download size={14} aria-hidden /> Download all</a>)}
        </div>
      </div>
      <FolderCrumbs kit={kit} />

      {active.map((j) => (
        <div key={j.id} className="panel" style={{ padding: "var(--space-4)", marginBottom: "var(--space-4)", display: "flex", gap: 16, alignItems: "center" }} role="status">
          {j.progress ? <StitchProgress total={j.progress.total} done={j.progress.done} /> : <span className="body-sm">Waiting to start...</span>}
          <span className="body-sm" style={{ flex: 1, color: "var(--ink-muted)" }}>{j.progress?.current ?? ""}</span>
          <Button size="sm" variant="danger" onClick={() => api.knit.cancel(j.id)}>Cancel</Button>
        </div>
      ))}

      {(knits?.length ?? 0) > 0 && (
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
          <Input aria-label={kit.here ? `Search ${nameOf(kit.here)} and the folders in it` : "Search knits"} placeholder="Search knits" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          <div style={{ minWidth: 150 }}><Select aria-label="Format" value={format} onValueChange={setFormat} options={[{ value: "all", label: "Every format" }, ...formats.map((f) => ({ value: f, label: f.toUpperCase() }))]} /></div>
          <ViewBar view={view} what="knits" />
        </div>
      )}
      {filtering ? (kit.here && <p className="body-sm" style={{ margin: "0 0 var(--space-3)", color: "var(--ink-muted)" }}>Looking in {nameOf(kit.here)} and the folders in it.</p>) : <FolderList kit={kit} />}
      {!knits || !kit.folders ? <Skeleton height={200} /> : knits.length === 0 && kit.folders.length === 0 ? (
        <EmptyState title="Nothing knitted yet" body="Open a pattern and press Knit. Everything you make from this project shows up here." />
      ) : here.length === 0 ? (
        filtering ? <EmptyState title="Nothing matches" body="Try another search or format." /> : kit.here && !kit.gone && foldersIn(kit.folders, kit.here).length === 0 && <EmptyState title={`Nothing in ${nameOf(kit.here)} yet`} body="Drag knits onto this folder, or open one and choose Move to folder." />
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
              <ul style={layout(view.mode, 190)}>
                {group.map((k) => {
                  const fresh = Date.parse(k.createdAt) > openedAt;
                  const warn = (k.report.issues ?? []).filter((i) => i.level === "warning").length;
                  if (view.mode === "list") return (
                    <li key={k.id} className={fresh ? "stitching-in" : undefined} draggable onDragStart={kit.dragThings([k.id])}>
                      <div className="card card-link" style={{ position: "relative", padding: "6px var(--space-3) 6px 6px", display: "grid", gridTemplateColumns: "56px minmax(0, 1fr) auto", gap: "var(--space-3)", alignItems: "center" }}>
                        <button aria-label={`Open ${k.label}`} onClick={() => setOpen(k)} style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent", border: 0, cursor: "pointer", borderRadius: "var(--radius-md)" }} />
                        <div aria-hidden className="thumb" style={{ width: 56, height: 56, padding: 4 }}>
                          {k.kind === "image" ? <img src={knitFileUrl(k)} alt="" loading="lazy" style={{ display: "block", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <video src={knitFileUrl(k)} muted preload="metadata" style={{ display: "block", maxWidth: "100%", maxHeight: "100%" }} />}
                        </div>
                        <div aria-hidden style={{ minWidth: 0 }}>
                          <p className="label" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.label}</p>
                          <p className="eyebrow" style={{ margin: "2px 0 0", display: "flex", gap: 6, alignItems: "center" }}>{k.format} · {k.width}x{k.height} · {formatBytes(k.bytes)}{warn > 0 && <span title={`${warn} to review`} style={{ color: "var(--danger)" }}><AlertTriangle size={12} aria-hidden /></span>}</p>
                        </div>
                        <span aria-hidden className="body-sm" style={{ color: "var(--ink-muted)", whiteSpace: "nowrap" }}>{timeAgo(k.createdAt)}</span>
                      </div>
                    </li>
                  );
                  return (
                    <li key={k.id} className={fresh ? "stitching-in" : undefined} draggable onDragStart={kit.dragThings([k.id])}>
                      <div className="card card-link" style={{ position: "relative", height: "100%", padding: "var(--space-2)" }}>
                        <button aria-label={`Open ${k.label}`} onClick={() => setOpen(k)} style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent", border: 0, cursor: "pointer", borderRadius: "var(--radius-md)" }} />
                        {/* On the card's 4:5 mat, as a pattern's card has it, so a row of knits lines up whatever their sizes. */}
                        <div aria-hidden className="thumb" style={{ padding: "var(--space-2)" }}>
                          <div style={{ width: k.width / k.height > 0.8 ? "100%" : `${(k.width / k.height / 0.8) * 100}%`, aspectRatio: `${k.width} / ${k.height}`, borderRadius: "var(--radius-sm)", overflow: "hidden", boxShadow: "0 1px 4px rgba(23,17,11,.18)" }}>
                            {k.kind === "image" ? <img src={knitFileUrl(k)} alt="" loading="lazy" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} /> : <video src={knitFileUrl(k)} muted preload="metadata" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />}
                          </div>
                        </div>
                        <p className="label" aria-hidden style={{ margin: "var(--space-2) 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.label}</p>
                        <p className="eyebrow" aria-hidden style={{ margin: "2px 0 0", display: "flex", gap: 6, alignItems: "center" }}>{k.format} · {k.width}x{k.height} · {formatBytes(k.bytes)}{warn > 0 && <span title={`${warn} to review`} style={{ color: "var(--danger)" }}><AlertTriangle size={12} aria-hidden /></span>}</p>
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
          <Button onClick={() => { kit.askMove([open], open.label); setOpen(null); }}><FolderInput size={14} aria-hidden /> Move to folder</Button>
          {open.kind === "image" && <Button onClick={async () => { try { const blob = await (await fetch(knitFileUrl(open))).blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); toast("Copied. Paste it anywhere."); } catch { toast("Your browser would not copy that. Use Download instead."); } }}><Copy size={14} aria-hidden /> Copy</Button>}
          <a className="btn btn-primary" href={knitFileUrl(open, true)}><Download size={14} aria-hidden /> Download</a>
        </>)}>
        {open && (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <div style={{ background: "var(--surface-sunken)", borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", maxHeight: "60dvh", overflow: "hidden" }}>
              {open.kind === "image" ? <img src={knitFileUrl(open)} alt={open.label} style={{ maxWidth: "100%", maxHeight: "60dvh", objectFit: "contain" }} /> : <video src={knitFileUrl(open)} controls style={{ maxWidth: "100%", maxHeight: "60dvh" }} />}
            </div>
            <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{open.format.toUpperCase()}, {open.width}x{open.height}, {formatBytes(open.bytes)}, knitted {timeAgo(open.createdAt)}. {open.patternId && <Link className="link" href={`/projects/${projectId}/patterns/${open.patternId}`}>Open the pattern</Link>}</p>
            {(open.report.issues ?? []).length > 0 && <ul style={{ margin: 0, paddingLeft: 18 }}>{open.report.issues!.map((i, n) => <li key={n} className="body-sm">{i.message}</li>)}</ul>}
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete this knit?" description="The file is removed from disk. You can knit it again from the pattern." confirmLabel="Delete file" onConfirm={async () => { await api.knit.remove(del!.id); await refresh(); toast("Deleted"); }} />
      <FolderDialogs kit={kit} />
    </div>
  );
}
