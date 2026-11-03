"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, uploadYarn, yarnFileUrl, yarnThumbUrl } from "@knitted/core/client";
import type { Yarn, YarnKind } from "@knitted/core";
import {
  Button, Chip, ConfirmDialog, Dialog, Drawer, DropZone, EmptyState, Field, Input, Menu, SegmentedControl, Skeleton, Textarea,
  ToggleChip, icons, useToast,
} from "@knitted/ui";
import { formatBytes, timeAgo, useLive } from "@/lib/hooks";
import { useUploads, type UploadItem } from "@/lib/uploads";

const { Upload, Plus, Search, FileText, Music, Film, Type, Image: ImageIcon, X, AlertTriangle, Trash2, Download, Link2: LinkIcon, RotateCcw } = icons;

const KINDS: { value: "all" | YarnKind; label: string }[] = [
  { value: "all", label: "All" }, { value: "image", label: "Images" }, { value: "video", label: "Video" },
  { value: "audio", label: "Audio" }, { value: "font", label: "Fonts" }, { value: "copy", label: "Copy" },
];
const KIND_ICON = { image: ImageIcon, video: Film, audio: Music, font: Type, copy: FileText } as const;

function useFontFace(y: Yarn): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (y.kind !== "font") return;
    let live = true;
    const face = new FontFace(`yarn-${y.id}`, `url(${yarnFileUrl(y)})`);
    face.load().then((f) => { document.fonts.add(f); if (live) setReady(true); }).catch(() => {});
    return () => { live = false; };
  }, [y]);
  return ready;
}

function Waveform({ peaks }: { peaks: number[] }) {
  return (
    <svg viewBox={`0 0 ${peaks.length} 40`} preserveAspectRatio="none" width="100%" height="100%" aria-hidden role="presentation">
      {peaks.map((p, i) => <rect key={i} x={i + 0.15} width={0.7} y={20 - Math.max(0.5, p * 20)} height={Math.max(1, p * 40)} fill="var(--ember)" rx={0.3} />)}
    </svg>
  );
}

export function YarnThumb({ y, large }: { y: Yarn; large?: boolean }) {
  const fontReady = useFontFace(y);
  const box: React.CSSProperties = { width: "100%", height: "100%", display: "grid", placeItems: "center", background: "var(--surface-sunken)" };
  if (y.meta.thumb) return <img src={yarnThumbUrl(y)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: large ? "contain" : "cover", background: "var(--surface-sunken)" }} />;
  if (y.kind === "font") return <div style={box}><span style={{ fontFamily: fontReady ? `yarn-${y.id}` : "var(--font-ui)", fontSize: large ? 96 : 44, lineHeight: 1 }}>Aa</span></div>;
  if (y.kind === "audio" && y.meta.peaks) return <div style={{ ...box, padding: 16 }}><Waveform peaks={y.meta.peaks} /></div>;
  if (y.kind === "copy") return <div style={{ ...box, padding: 12, alignItems: "start", overflow: "hidden" }}><p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)", display: "-webkit-box", WebkitLineClamp: large ? 12 : 5, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-wrap" }}>{y.meta.text}</p></div>;
  const I = KIND_ICON[y.kind];
  return <div style={box}><I size={28} aria-hidden /></div>;
}

function UploadTray({ items, onCancel, onClear }: { items: UploadItem[]; onCancel: (id: number) => void; onClear: () => void }) {
  if (!items.length) return null;
  const active = items.filter((i) => i.status === "uploading" || i.status === "queued").length;
  return (
    <div className="panel floating" role="region" aria-label="Uploads" style={{ position: "fixed", right: 16, bottom: 16, width: 340, maxHeight: 360, overflow: "auto", padding: "var(--space-3)", zIndex: 40 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
        <span className="label">{active ? `Uploading ${active}` : "Uploads done"}</span>
        {!active && <button className="btn btn-ghost btn-sm" onClick={onClear}>Clear</button>}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-2)" }}>
        {items.map((i) => (
          <li key={i.id} className="body-sm">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.name}</span>
              {(i.status === "uploading" || i.status === "queued") && <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label={`Cancel ${i.name}`} onClick={() => onCancel(i.id)}><X size={13} /></button>}
            </div>
            {(i.status === "uploading" || i.status === "queued") && (
              <div role="progressbar" aria-label={`Uploading ${i.name}`} aria-valuenow={Math.round(i.progress * 100)} aria-valuemin={0} aria-valuemax={100} style={{ height: 4, background: "var(--line)", borderRadius: 2, marginTop: 4 }}>
                <div style={{ width: `${i.progress * 100}%`, height: "100%", background: "var(--ember)", borderRadius: 2, transition: "width 120ms linear" }} />
              </div>
            )}
            {i.status === "done" && <span style={{ color: "var(--success)" }}>Added</span>}
            {i.status === "existing" && <span style={{ color: "var(--ink-muted)" }}>Already in Yarn, using the existing one</span>}
            {i.status === "cancelled" && <span style={{ color: "var(--ink-muted)" }}>Cancelled</span>}
            {i.status === "error" && <span className="field-error"><AlertTriangle size={13} aria-hidden /> {i.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function YarnView({ projectId }: { projectId: string }) {
  const toast = useToast();
  const [kind, setKind] = useState<"all" | YarnKind>("all");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | undefined>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [bulkDelete, setBulkDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data, refresh } = useLive(() => api.yarn.list(projectId, { kind: kind === "all" ? undefined : kind, q: q || undefined, tag }), [projectId, kind, q, tag]);
  const { data: all } = useLive(() => api.yarn.list(projectId), [projectId]);
  const uploads = useUploads(projectId, refresh);
  const allTags = useMemo(() => [...new Set((all ?? []).flatMap((y) => y.tags))].sort(), [all]);

  // Paste an image (a screenshot) straight in.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const files = [...(e.clipboardData?.files ?? [])].map((f) => f.name && f.name !== "image.png" ? f : new File([f], `Pasted image ${new Date().toLocaleTimeString().replace(/[:\s]/g, "-")}.png`, { type: f.type }));
      if (files.length) { e.preventDefault(); uploads.add(files); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [uploads]);

  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files");
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const removeOne = async (y: Yarn) => {
    await api.yarn.remove(y.id); await refresh(); setDetail(null);
    toast(`Deleted ${y.name}`, { label: "Undo", onClick: async () => { await api.yarn.undelete(y.id); await refresh(); } }, 10_000);
  };

  return (
    <div
      onDragEnter={(e) => { if (hasFiles(e)) { e.preventDefault(); setOver(true); } }}
      onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={(e) => { if (hasFiles(e)) { e.preventDefault(); setOver(false); uploads.add([...e.dataTransfer.files]); } }}
      style={{ position: "relative", minHeight: 420 }}
    >
      {over && <div aria-hidden style={{ position: "absolute", inset: -8, zIndex: 20, border: "2px dashed var(--ember)", background: "var(--tint)", borderRadius: "var(--radius-lg)", display: "grid", placeItems: "center" }}><span className="h2">Drop to add to Yarn</span></div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        <h2 className="h2">Yarn</h2>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button onClick={() => setUrlOpen(true)}><LinkIcon size={14} aria-hidden /> From a link</Button>
          <Button onClick={() => setCopyOpen(true)}><FileText size={14} aria-hidden /> New copy</Button>
          <Button variant="primary" onClick={() => fileInput.current?.click()}><Upload size={14} aria-hidden /> Upload</Button>
          <input ref={fileInput} type="file" multiple hidden aria-label="Choose files to upload" onChange={(e) => { uploads.add([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </div>
      </div>

      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        <SegmentedControl<"all" | YarnKind> label="Kind" value={kind} onChange={setKind} options={KINDS} />
        <div style={{ position: "relative", width: 220 }}>
          <Search size={15} aria-hidden style={{ position: "absolute", left: 10, top: 10, color: "var(--ink-muted)" }} />
          <Input aria-label="Search yarn" placeholder="Search yarn" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        {allTags.map((t) => <ToggleChip key={t} pressed={tag === t} onClick={() => setTag(tag === t ? undefined : t)}>{t}</ToggleChip>)}
      </div>

      {selected.size > 0 && (
        <div role="toolbar" aria-label="Selection" style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", padding: "var(--space-2) var(--space-3)", background: "var(--tint)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-4)" }}>
          <span className="label">{selected.size} selected</span>
          <Button size="sm" onClick={async () => { const t = window.prompt("Tag to add"); if (t) { for (const y of data ?? []) if (selected.has(y.id)) await api.yarn.update(y.id, { tags: [...y.tags, t] }); await refresh(); } }}>Add tag</Button>
          <Button size="sm" variant="danger" onClick={() => setBulkDelete(true)}><Trash2 size={13} aria-hidden /> Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {!data ? (
        <div style={{ display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={170} />)}</div>
      ) : data.length === 0 ? (
        q || tag || kind !== "all" ? <EmptyState title="Nothing matches" body="Try a different filter or search." /> : (
          <DropZone onFiles={uploads.add}>
            <ImageIcon size={32} aria-hidden />
            <p className="h3" style={{ margin: "var(--space-3) 0 4px", color: "var(--ink)" }}>Add your first Yarn</p>
            <p className="body-sm" style={{ margin: "0 0 var(--space-4)" }}>Drop photos, logos, video, audio, fonts or text here. You can also paste a screenshot.</p>
            <Button variant="primary" onClick={() => fileInput.current?.click()}>Choose files</Button>
          </DropZone>
        )
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
          {data.map((y) => {
            // One string for what is SHOWN and what is announced, so they cannot disagree.
            const facts = `${y.kind}${y.width ? ` · ${y.width}x${y.height}` : ""}${y.durationMs ? ` · ${(y.durationMs / 1000).toFixed(1)}s` : ""}`;
            return (
            <li key={y.id} className="yarn-card" data-selected={selected.has(y.id)}>
              <input type="checkbox" className="yarn-check" aria-label={`Select ${y.name}`} checked={selected.has(y.id)} onChange={() => toggle(y.id)} />
              <div className="card card-link" style={{ position: "relative", padding: "var(--space-2)", outline: selected.has(y.id) ? "2px solid var(--ember)" : undefined }}>
                {/* The whole card is one empty button that carries the name, so the
                    announced name and the visible text cannot disagree. */}
                <button aria-label={`${y.name} ${facts}`} onClick={() => setDetail(y.id)} style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent", border: 0, borderRadius: "var(--radius-md)", cursor: "pointer" }} />
                <div aria-hidden style={{ aspectRatio: "1 / 1", borderRadius: "var(--radius-sm)", overflow: "hidden" }}><YarnThumb y={y} /></div>
                <p className="label" aria-hidden style={{ margin: "var(--space-2) 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{y.name}</p>
                <p className="eyebrow" aria-hidden style={{ margin: "2px 0 0", display: "flex", gap: 6, alignItems: "center" }}>
                  {facts}
                  {y.meta.warnings?.length ? <span title={y.meta.warnings[0]} style={{ color: "var(--danger)" }}><AlertTriangle size={12} aria-hidden /></span> : null}
                </p>
              </div>
            </li>
            );
          })}
        </ul>
      )}

      <UploadTray items={uploads.items} onCancel={uploads.cancel} onClear={uploads.clearFinished} />
      <YarnDrawer id={detail} projectId={projectId} onClose={() => setDetail(null)} onChanged={refresh} onDelete={removeOne} />
      <NewCopyDialog open={copyOpen} onOpenChange={setCopyOpen} projectId={projectId} onDone={refresh} />
      <FromUrlDialog open={urlOpen} onOpenChange={setUrlOpen} projectId={projectId} onDone={refresh} />
      <ConfirmDialog open={bulkDelete} onOpenChange={setBulkDelete} title={`Delete ${selected.size} yarn?`} description="You can undo it for a while. Patterns that use them will show a missing-yarn marker." confirmLabel="Delete"
        onConfirm={async () => { for (const id of selected) await api.yarn.remove(id); setSelected(new Set()); await refresh(); toast("Deleted"); }} />
    </div>
  );
}

function YarnDrawer({ id, projectId, onClose, onChanged, onDelete }: { id: string | null; projectId: string; onClose: () => void; onChanged: () => void; onDelete: (y: Yarn) => Promise<void> }) {
  const toast = useToast();
  const { data, refresh } = useLive(() => (id ? api.yarn.get(id) : Promise.resolve(null)), [id]);
  const [name, setName] = useState("");
  const [tagText, setTagText] = useState("");
  const [confirm, setConfirm] = useState(false);
  const replace = useRef<HTMLInputElement>(null);
  const y = data?.yarn;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (y) setName(y.name);
  }, [y?.id, y?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (p: { name?: string; tags?: string[] }) => { await api.yarn.update(y!.id, p); await refresh(); onChanged(); }, [y, refresh, onChanged]);

  return (
    <Drawer open={!!id} onOpenChange={(o) => !o && onClose()} title={y?.name ?? "Yarn"}>
      {y && data && (
        <div style={{ display: "grid", gap: "var(--space-5)" }}>
          <p className="eyebrow" style={{ marginTop: 4 }}>{y.kind}</p>
          <div style={{ borderRadius: "var(--radius-md)", overflow: "hidden", background: "var(--surface-sunken)", maxHeight: 320, display: "grid", placeItems: "center" }}>
            {y.kind === "video" ? <video src={yarnFileUrl(y)} controls preload="metadata" poster={y.meta.thumb ? yarnThumbUrl(y) : undefined} style={{ width: "100%", maxHeight: 320 }} />
              : y.kind === "audio" ? <div style={{ width: "100%", padding: 16 }}><div style={{ height: 70 }}>{y.meta.peaks && <Waveform peaks={y.meta.peaks} />}</div><audio src={yarnFileUrl(y)} controls style={{ width: "100%", marginTop: 8 }} /></div>
              : <div style={{ width: "100%", height: y.kind === "image" ? 320 : 180 }}><YarnThumb y={y} large /></div>}
          </div>
          <Field label="Name" htmlFor="yd-name">
            <Input id="yd-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== y.name && name.trim() && save({ name })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
          </Field>
          <Field label="Tags" hint="Press Enter to add. Tags make a batch easy to pick from.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {y.tags.map((t) => <Chip key={t}>{t}<button className="icon-btn" style={{ width: 18, height: 18 }} aria-label={`Remove tag ${t}`} onClick={() => save({ tags: y.tags.filter((x) => x !== t) })}><X size={11} /></button></Chip>)}
            </div>
            <Input aria-label="Add a tag" value={tagText} placeholder="Add a tag" onChange={(e) => setTagText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tagText.trim()) { void save({ tags: [...y.tags, tagText] }); setTagText(""); } }} />
          </Field>
          {y.meta.warnings?.map((w) => <p key={w} className="field-error" style={{ margin: 0 }}><AlertTriangle size={14} aria-hidden /> {w}</p>)}
          <dl className="body-sm" style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "6px 12px", margin: 0 }}>
            <dt style={{ color: "var(--ink-muted)" }}>Size</dt><dd style={{ margin: 0 }}>{formatBytes(y.bytes)}</dd>
            {y.width && <><dt style={{ color: "var(--ink-muted)" }}>Dimensions</dt><dd style={{ margin: 0 }}>{y.width} x {y.height}</dd></>}
            {y.durationMs && <><dt style={{ color: "var(--ink-muted)" }}>Length</dt><dd style={{ margin: 0 }}>{(y.durationMs / 1000).toFixed(1)}s</dd></>}
            {y.meta.family && <><dt style={{ color: "var(--ink-muted)" }}>Family</dt><dd style={{ margin: 0 }}>{y.meta.family}</dd></>}
            {y.meta.colors && <><dt style={{ color: "var(--ink-muted)" }}>Colours</dt><dd style={{ margin: 0, display: "flex", gap: 4 }}>{y.meta.colors.map((c) => <span key={c} title={c} style={{ width: 18, height: 18, borderRadius: "50%", background: c, boxShadow: "0 0 0 1px var(--line-strong)" }} />)}</dd></>}
            <dt style={{ color: "var(--ink-muted)" }}>Added</dt><dd style={{ margin: 0 }}>{timeAgo(y.createdAt)}</dd>
            <dt style={{ color: "var(--ink-muted)" }}>Original</dt><dd style={{ margin: 0, wordBreak: "break-all" }}>{y.originalName}</dd>
          </dl>
          <div>
            <p className="eyebrow" style={{ marginBottom: 6 }}>Used in</p>
            {data.usage.length === 0 ? <p className="body-sm" style={{ color: "var(--ink-muted)", margin: 0 }}>Not used in any pattern yet.</p> : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>{data.usage.map((u) => <li key={u.patternId} className="body-sm"><Link href={`/projects/${projectId}/patterns/${u.patternId}`} className="link">{u.patternName}</Link></li>)}</ul>
            )}
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <Button onClick={() => replace.current?.click()}><RotateCcw size={14} aria-hidden /> Replace file</Button>
            <input ref={replace} type="file" hidden aria-label="Choose a replacement file" onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
              try { await uploadYarn(projectId, f, () => {}, { replaceId: y.id }).promise; await refresh(); onChanged(); toast("Replaced. Every pattern using it now shows the new file."); } catch (err) { toast((err as Error).message); }
            }} />
            <a className="btn btn-secondary" href={yarnFileUrl(y)} download={y.originalName}><Download size={14} aria-hidden /> Download</a>
            {(y.kind === "image" || y.kind === "video") && y.meta.thumb && (
              <Button onClick={async () => { try { await api.projects.update(projectId, { coverYarnId: y.id }); toast("It is now the project's picture, on its card in Projects."); } catch (err) { toast((err as Error).message); } }}>
                <ImageIcon size={14} aria-hidden /> Use as project picture
              </Button>
            )}
            <Button variant="danger" onClick={() => (data.usage.length ? setConfirm(true) : onDelete(y))}><Trash2 size={14} aria-hidden /> Delete</Button>
          </div>
          <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Delete ${y.name}?`}
            description={`It is used in ${data.usage.length} ${data.usage.length === 1 ? "pattern" : "patterns"}: ${data.usage.map((u) => u.patternName).join(", ")}. Those stitches will show a missing-yarn marker until you choose another. You can undo this for a while.`}
            confirmLabel="Delete yarn" onConfirm={() => onDelete(y)} />
        </div>
      )}
    </Drawer>
  );
}

function NewCopyDialog({ open, onOpenChange, projectId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; onDone: () => void }) {
  const [name, setName] = useState(""); const [text, setText] = useState(""); const [err, setErr] = useState<string | undefined>();
  const save = async () => { try { await api.yarn.copy(projectId, { name: name || "Copy", text }); onOpenChange(false); setName(""); setText(""); setErr(undefined); onDone(); } catch (e) { setErr((e as Error).message); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New copy" description="Headlines, captions, hashtags: words you want to reuse across posts."
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={save}>Save copy</Button></>}>
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label="Name" htmlFor="nc-name"><Input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Launch headlines" /></Field>
        <Field label="Text" htmlFor="nc-text" error={err} hint={`${text.length} characters`}><Textarea id="nc-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function FromUrlDialog({ open, onOpenChange, projectId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; onDone: () => void }) {
  const [url, setUrl] = useState(""); const [err, setErr] = useState<string | undefined>(); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await api.yarn.fromUrl(projectId, url); onOpenChange(false); setUrl(""); setErr(undefined); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add from a link" description="knitted fetches this one file when you press Add. Nothing else is contacted."
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={busy || !url} onClick={go}>{busy ? "Fetching..." : "Add"}</Button></>}>
      <Field label="Link" htmlFor="fu-url" error={err}><Input id="fu-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/logo.png" onKeyDown={(e) => e.key === "Enter" && url && go()} /></Field>
    </Dialog>
  );
}

void Plus; void Menu;
