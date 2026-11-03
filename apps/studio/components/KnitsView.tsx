"use client";

import Link from "next/link";
import { useState } from "react";
import { api, knitFileUrl, type KnitRecord, type JobItem } from "@knitted/core/client";
import { Button, ConfirmDialog, Dialog, EmptyState, Skeleton, StitchProgress, icons, useToast } from "@knitted/ui";
import { formatBytes, timeAgo, useLive } from "@/lib/hooks";

const { Download, Trash2, AlertTriangle, Copy } = icons;

export function KnitsView({ projectId }: { projectId: string }) {
  const toast = useToast();
  const { data: knits, refresh } = useLive(() => api.knit.list(projectId), [projectId]);
  const { data: jobs } = useLive(() => fetch(`/api/projects/${projectId}/jobs`).then((r) => r.json() as Promise<JobItem[]>), [projectId]);
  const [open, setOpen] = useState<KnitRecord | null>(null);
  const [del, setDel] = useState<KnitRecord | null>(null);
  // Anything knitted after this page opened is new, and gets the signature "stitching in" reveal.
  const [openedAt] = useState(() => Date.now());

  const active = (jobs ?? []).filter((j) => j.kind === "knit" && (j.status === "running" || j.status === "queued"));
  const batches = new Map<string, KnitRecord[]>();
  for (const k of knits ?? []) { const key = k.batchId ?? k.id; batches.set(key, [...(batches.get(key) ?? []), k]); }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
        <h2 className="h2">Knits</h2>
        {knits && knits.length > 0 && <a className="btn btn-secondary" href={`/api/projects/${projectId}/knits/zip`}><Download size={14} aria-hidden /> Download all</a>}
      </div>

      {active.map((j) => (
        <div key={j.id} className="panel" style={{ padding: "var(--space-4)", marginBottom: "var(--space-4)", display: "flex", gap: 16, alignItems: "center" }} role="status">
          {j.progress ? <StitchProgress total={j.progress.total} done={j.progress.done} /> : <span className="body-sm">Waiting to start...</span>}
          <span className="body-sm" style={{ flex: 1, color: "var(--ink-muted)" }}>{j.progress?.current ?? ""}</span>
          <Button size="sm" variant="danger" onClick={() => api.knit.cancel(j.id)}>Cancel</Button>
        </div>
      ))}

      {!knits ? <Skeleton height={200} /> : knits.length === 0 ? (
        <EmptyState title="Nothing knitted yet" body="Open a pattern and press Knit. Everything you make from this project shows up here." />
      ) : (
        <div style={{ display: "grid", gap: "var(--space-8)" }}>
          {[...batches.values()].map((group) => (
            <section key={group[0].batchId ?? group[0].id} aria-label={group.length > 1 ? `Batch of ${group.length}` : group[0].label}>
              {group.length > 1 && <h3 className="eyebrow" style={{ marginBottom: 8, display: "flex", gap: 12, alignItems: "center" }}>Batch of {group.length} · {timeAgo(group[0].createdAt)} <a className="link" href={`/api/projects/${projectId}/knits/zip?batch=${group[0].batchId}`}>Download batch</a></h3>}
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
                {group.map((k) => {
                  const fresh = Date.parse(k.createdAt) > openedAt;
                  const warn = (k.report.issues ?? []).filter((i) => i.level === "warning").length;
                  return (
                    <li key={k.id} className={fresh ? "stitching-in" : undefined}>
                      <div className="card card-link" style={{ position: "relative", padding: "var(--space-2)" }}>
                        <button aria-label={`Open ${k.label}`} onClick={() => setOpen(k)} style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent", border: 0, cursor: "pointer", borderRadius: "var(--radius-md)" }} />
                        <div aria-hidden className="thumb" style={{ aspectRatio: `${k.width} / ${k.height}`, maxHeight: 260, background: "var(--surface-sunken)" }}>
                          {k.kind === "image" ? <img src={knitFileUrl(k)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <video src={knitFileUrl(k)} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
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
    </div>
  );
}
