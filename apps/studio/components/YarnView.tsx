"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, pdfPageUrl, uploadYarn, yarnFileUrl, yarnThumbUrl } from "@knitted/core/client";
import { isInside, nameOf, type CropBox, type Shelf, type Yarn, type YarnKind } from "@knitted/core";
import {
  Button, Chip, ConfirmDialog, Dialog, Drawer, DropZone, EmptyState, Field, IconButton, Input, Menu, SegmentedControl, Skeleton, Textarea,
  Tip, ToggleChip, icons, useToast,
} from "@knitted/ui";
import { formatBytes, timeAgo, useLive } from "@/lib/hooks";
import { useUploads, type UploadItem } from "@/lib/uploads";
import { FolderCrumbs, FolderDialogs, FolderList, InFolder, NewFolderButton, counted, useFolders } from "./Folders";
import { ViewBar, commonSorts, layout, useView, type SortBy } from "./Views";

const { Upload, Plus, Search, FileText, Music, Film, Type, Image: ImageIcon, X, AlertTriangle, Trash2, Download, Link2: LinkIcon, RotateCcw, FolderInput, FilePdf, Crop, BookOpen, Monitor, Smartphone, ChevronLeft, ChevronRight } = icons;
const spoken = (path: string) => path.split("/").join(" / ");

const KINDS: { value: "all" | YarnKind; label: string }[] = [
  { value: "all", label: "All" }, { value: "image", label: "Images" }, { value: "video", label: "Video" },
  { value: "audio", label: "Audio" }, { value: "font", label: "Fonts" }, { value: "pdf", label: "PDFs" }, { value: "copy", label: "Copy" },
];
const KIND_ICON = { image: ImageIcon, video: Film, audio: Music, font: Type, copy: FileText, pdf: FilePdf } as const;
const KIND_WORD: Record<YarnKind, string> = { image: "picture", video: "video", audio: "sound", font: "font", copy: "copy", pdf: "PDF" };

/** What each shelf is called, and what it says about itself. */
const SHELF = {
  yarn: { title: "Yarn", what: "Yarn", copy: "New copy", copyName: "Copy", search: "Search yarn", first: "Add your first Yarn", drop: "Drop photos, logos, video, audio, fonts, PDFs or text here. You can also paste a screenshot." },
  reference: { title: "Reference", what: "the reference", copy: "New note", copyName: "Note", search: "Search the reference", first: "Add reference", drop: "Drop menus, brochures, price lists, screenshots and photos of the business here: things for your model to look at and read. Cut a picture out of one into Yarn to use it in a pattern." },
} as const;

/** One line of what a file is: kind, size, length, pages. Shown and announced alike. */
const factsOf = (y: Yarn) => `${y.kind === "pdf" ? "PDF" : y.kind}${y.width ? ` · ${y.width}x${y.height}` : ""}${y.durationMs ? ` · ${(y.durationMs / 1000).toFixed(1)}s` : ""}${y.kind === "pdf" ? ` · ${y.meta.pages ?? 1} page${(y.meta.pages ?? 1) === 1 ? "" : "s"}` : ""}`;

const YARN_SORTS: SortBy<Yarn>[] = [
  ...commonSorts<Yarn>(),
  { value: "kind", label: "Kind", key: (y) => `${y.kind} ${y.name}` },
  { value: "size", label: "Biggest first", key: (y) => y.bytes, desc: true },
];

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

/** `top`: a picture of a whole web page shows its top, where the page starts, not its middle. */
export function YarnThumb({ y, large, top }: { y: Yarn; large?: boolean; top?: boolean }) {
  const fontReady = useFontFace(y);
  const box: React.CSSProperties = { width: "100%", height: "100%", display: "grid", placeItems: "center", background: "var(--surface-sunken)" };
  if (y.meta.thumb) return <img src={yarnThumbUrl(y)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: large ? "contain" : "cover", objectPosition: top && !large ? "top" : undefined, background: "var(--surface-sunken)" }} />;
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
            {i.status === "existing" && <span style={{ color: "var(--ink-muted)" }}>{i.folder === undefined || i.folder === i.into ? "Already in Yarn, using the existing one" : `Already in Yarn, ${i.folder ? `in ${spoken(i.folder)}` : "at the top"}, using that one`}</span>}
            {i.status === "cancelled" && <span style={{ color: "var(--ink-muted)" }}>Cancelled</span>}
            {i.status === "error" && <span className="field-error"><AlertTriangle size={13} aria-hidden /> {i.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function YarnView({ projectId, shelf = "yarn", heading = true }: { projectId: string; shelf?: Shelf; heading?: boolean }) {
  const toast = useToast();
  const words = SHELF[shelf];
  const section = shelf === "reference" ? "reference" : "yarn";
  const view = useView<Yarn>(section, YARN_SORTS, { sort: "newest" });
  const [cropping, setCropping] = useState<Yarn | null>(null);
  // Yarn is what a list is when it says no shelf.
  const asked = shelf === "yarn" ? undefined : shelf;
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

  const { data, refresh } = useLive(() => api.yarn.list(projectId, { kind: kind === "all" ? undefined : kind, q: q || undefined, tag, shelf: asked }), [projectId, kind, q, tag, shelf]);
  const { data: all, refresh: refreshAll } = useLive(() => api.yarn.list(projectId, { shelf: asked }), [projectId, shelf]);
  const reload = useCallback(async () => { await Promise.all([refresh(), refreshAll()]); }, [refresh, refreshAll]);
  const kit = useFolders(projectId, section, all, { onChanged: reload });
  const uploads = useUploads(projectId, reload, shelf);
  const allTags = useMemo(() => [...new Set((all ?? []).flatMap((y) => y.tags))].sort(), [all]);
  // A search or a filter looks in the folder the person is in and every folder inside it;
  // otherwise the folder shows what is in it, with its folders above.
  const filtering = !!(q || tag || kind !== "all");
  const shown = useMemo(() => view.sorted((data ?? []).filter((y) => (filtering ? isInside(y.folder, kit.here) : y.folder === kit.here))), [data, filtering, kit.here, view]);
  // What is selected and still in sight: moving it away, or opening another folder, lets it go.
  const picked = shown.filter((y) => selected.has(y.id));

  // Paste an image (a screenshot) straight in.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const files = [...(e.clipboardData?.files ?? [])].map((f) => f.name && f.name !== "image.png" ? f : new File([f], `Pasted image ${new Date().toLocaleTimeString().replace(/[:\s]/g, "-")}.png`, { type: f.type }));
      if (files.length) { e.preventDefault(); uploads.add(files, kit.here); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [uploads, kit.here]);

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
      onDrop={(e) => { if (hasFiles(e)) { e.preventDefault(); setOver(false); uploads.add([...e.dataTransfer.files], kit.here); } }}
      style={{ position: "relative", minHeight: 420 }}
    >
      {over && <div aria-hidden style={{ position: "absolute", inset: -8, zIndex: 20, border: "2px dashed var(--ember)", background: "var(--tint)", borderRadius: "var(--radius-lg)", display: "grid", placeItems: "center" }}><span className="h2">Drop to add to {kit.here ? nameOf(kit.here) : words.title}</span></div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        {heading ? <h2 className="h2">{words.title}</h2> : <h3 className="h3" style={{ margin: 0 }}>{words.title}</h3>}
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <NewFolderButton kit={kit} />
          <Button tip="Fetch one file from a public web address" onClick={() => setUrlOpen(true)}><LinkIcon size={14} aria-hidden /> From a link</Button>
          <Button tip={shelf === "reference" ? "Write down something to know about the business" : "Save words to reuse: headlines, captions, hashtags"} onClick={() => setCopyOpen(true)}><FileText size={14} aria-hidden /> {words.copy}</Button>
          <Button variant="primary" tip="Pictures, video, sound, fonts, PDFs or text, from this computer. You can also drop or paste them here." onClick={() => fileInput.current?.click()}><Upload size={14} aria-hidden /> Upload</Button>
          <input ref={fileInput} type="file" multiple hidden aria-label="Choose files to upload" onChange={(e) => { uploads.add([...(e.target.files ?? [])], kit.here); e.target.value = ""; }} />
        </div>
      </div>

      <FolderCrumbs kit={kit} />
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        <SegmentedControl<"all" | YarnKind> label="Kind" value={kind} onChange={setKind} options={KINDS} />
        <div style={{ position: "relative", width: 220 }}>
          <Search size={15} aria-hidden style={{ position: "absolute", left: 10, top: 10, color: "var(--ink-muted)" }} />
          <Input aria-label={kit.here ? `Search ${nameOf(kit.here)} and the folders in it` : words.search} placeholder={kit.here ? `Search ${nameOf(kit.here)}` : words.search} value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        {allTags.map((t) => <ToggleChip key={t} pressed={tag === t} onClick={() => setTag(tag === t ? undefined : t)}>{t}</ToggleChip>)}
        <ViewBar view={view} what={shelf === "reference" ? "the reference" : "Yarn"} />
      </div>

      {picked.length > 0 && (
        <div role="toolbar" aria-label="Selection" style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap", padding: "var(--space-2) var(--space-3)", background: "var(--tint)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-4)" }}>
          <span className="label">{picked.length} selected</span>
          <Button size="sm" onClick={() => kit.askMove(picked, counted(picked.length, section))}><FolderInput size={13} aria-hidden /> Move to folder</Button>
          <Button size="sm" tip={shelf === "yarn" ? "To the Brief: for your model to look at, not to put in a pattern" : "To Yarn, to put in a pattern"} onClick={async () => { const ids = picked.map((y) => y.id); await kit.attempt(() => api.folders.move(projectId, shelf === "yarn" ? "reference" : "yarn", ids, "")); setSelected(new Set()); await reload(); toast(`Moved ${counted(ids.length, section)} to ${shelf === "yarn" ? "the reference, in the Brief" : "Yarn"}`); }}>
            <BookOpen size={13} aria-hidden /> {shelf === "yarn" ? "Move to the Brief" : "Move to Yarn"}
          </Button>
          <Button size="sm" onClick={async () => { const t = window.prompt("Tag to add"); if (t) { for (const y of picked) await api.yarn.update(y.id, { tags: [...y.tags, t] }); await refresh(); } }}>Add tag</Button>
          <Button size="sm" variant="danger" onClick={() => setBulkDelete(true)}><Trash2 size={13} aria-hidden /> Delete</Button>
          {picked.length < shown.length && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(shown.map((y) => y.id)))}>Select all {shown.length}</Button>}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {filtering ? (kit.here && <p className="body-sm" style={{ margin: "0 0 var(--space-3)", color: "var(--ink-muted)" }}>Looking in {nameOf(kit.here)} and the folders in it.</p>) : <FolderList kit={kit} />}

      {!data || !all || !kit.folders ? (
        <div style={{ display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={170} />)}</div>
      ) : shown.length === 0 ? (
        filtering ? <EmptyState title="Nothing matches" body={kit.here ? `Nothing in ${nameOf(kit.here)} or the folders in it matches. Try a different filter or search.` : "Try a different filter or search."} />
        : all.length === 0 && kit.folders.length === 0 ? (
          <DropZone onFiles={(f) => uploads.add(f, kit.here)}>
            <ImageIcon size={32} aria-hidden />
            <p className="h3" style={{ margin: "var(--space-3) 0 4px", color: "var(--ink)" }}>{words.first}</p>
            <p className="body-sm" style={{ margin: "0 0 var(--space-4)" }}>{words.drop}</p>
            <Button variant="primary" onClick={() => fileInput.current?.click()}>Choose files</Button>
          </DropZone>
        ) : kit.here && !kit.gone && kit.countIn(kit.here) === 0 && !kit.folders.some((f) => f !== kit.here && isInside(f, kit.here)) ? (
          <DropZone onFiles={(f) => uploads.add(f, kit.here)}>
            <ImageIcon size={32} aria-hidden />
            <p className="h3" style={{ margin: "var(--space-3) 0 4px", color: "var(--ink)" }}>Nothing in {nameOf(kit.here)} yet</p>
            <p className="body-sm" style={{ margin: "0 0 var(--space-4)" }}>Drop files here to add them to this folder, or drag files onto it from another one.</p>
            <Button variant="primary" onClick={() => fileInput.current?.click()}>Choose files</Button>
          </DropZone>
        ) : null
      ) : (
        <ul aria-label={kit.here ? `${words.title} in ${nameOf(kit.here)}` : words.title} data-view={view.mode} style={layout(view.mode)}>
          {shown.map((y) => {
            // One string for what is SHOWN and what is announced, so they cannot disagree.
            const facts = factsOf(y);
            // Gathered from the folders inside this one: say which.
            const from = y.folder !== kit.here ? y.folder : "";
            const site = y.meta.site;
            const Device = site?.device === "mobile" ? Smartphone : Monitor;
            const cover = <button aria-label={`${y.name} ${facts}${from ? `, in ${spoken(from)}` : ""}`} onClick={() => setDetail(y.id)} style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent", border: 0, borderRadius: "var(--radius-md)", cursor: "pointer" }} />;
            const warn = y.meta.warnings?.length ? <span title={y.meta.warnings[0]} style={{ color: "var(--danger)" }}><AlertTriangle size={12} aria-hidden /></span> : null;
            return view.mode === "grid" ? (
            <li key={y.id} className="yarn-card" data-selected={selected.has(y.id)} draggable onDragStart={kit.dragThings(selected.has(y.id) ? picked.map((x) => x.id) : [y.id])}>
              <input type="checkbox" className="yarn-check" aria-label={`Select ${y.name}`} checked={selected.has(y.id)} onChange={() => toggle(y.id)} />
              <div className="card card-link" style={{ position: "relative", padding: "var(--space-2)", outline: selected.has(y.id) ? "2px solid var(--ember)" : undefined }}>
                {/* The whole card is one empty button that carries the name, so the
                    announced name and the visible text cannot disagree. */}
                {cover}
                <div aria-hidden style={{ aspectRatio: "1 / 1", borderRadius: "var(--radius-sm)", overflow: "hidden", position: "relative" }}>
                  <YarnThumb y={y} top={!!site} />
                  {site && <span className="chip" style={{ position: "absolute", left: 6, bottom: 6, display: "inline-flex", gap: 4, alignItems: "center" }}><Device size={12} aria-hidden />{site.device === "mobile" ? "Phone" : "Desktop"}</span>}
                </div>
                <p className="label" aria-hidden style={{ margin: "var(--space-2) 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{y.name}</p>
                <p className="eyebrow" aria-hidden style={{ margin: "2px 0 0", display: "flex", gap: 6, alignItems: "center" }}>{facts}{warn}</p>
                {from && <span aria-hidden style={{ display: "block", marginTop: 2 }}><InFolder path={from} /></span>}
              </div>
            </li>
            ) : (
            <li key={y.id} className="yarn-row" data-selected={selected.has(y.id)} draggable onDragStart={kit.dragThings(selected.has(y.id) ? picked.map((x) => x.id) : [y.id])}>
              <input type="checkbox" aria-label={`Select ${y.name}`} checked={selected.has(y.id)} onChange={() => toggle(y.id)} style={{ position: "relative", zIndex: 2 }} />
              <div className="card card-link" style={{ position: "relative", display: "grid", gridTemplateColumns: "48px minmax(0, 1fr) auto", gap: "var(--space-3)", alignItems: "center", padding: "6px var(--space-3) 6px 6px", outline: selected.has(y.id) ? "2px solid var(--ember)" : undefined }}>
                {cover}
                <div aria-hidden style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", overflow: "hidden" }}><YarnThumb y={y} top={!!site} /></div>
                <div aria-hidden style={{ minWidth: 0 }}>
                  <p className="label" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{y.name}</p>
                  <p className="eyebrow" style={{ margin: "2px 0 0", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {facts}{warn}
                    {site && <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><Device size={12} aria-hidden />{site.url.replace(/^https?:\/\//, "")}</span>}
                    {from && <InFolder path={from} />}
                    {y.tags.length > 0 && <span>{y.tags.join(", ")}</span>}
                  </p>
                </div>
                <span aria-hidden className="body-sm" style={{ color: "var(--ink-muted)", whiteSpace: "nowrap" }}>{formatBytes(y.bytes)} · {timeAgo(y.createdAt)}</span>
              </div>
            </li>
            );
          })}
        </ul>
      )}

      <UploadTray items={uploads.items} onCancel={uploads.cancel} onClear={uploads.clearFinished} />
      <YarnDrawer id={detail} projectId={projectId} onClose={() => setDetail(null)} onChanged={reload} onDelete={removeOne} onMove={(y) => kit.askMove([y], y.name)} onCrop={setCropping}
        onShelf={async (y) => {
          const to: Shelf = y.shelf === "yarn" ? "reference" : "yarn";
          if (await kit.attempt(() => api.folders.move(projectId, to, [y.id], ""))) { setDetail(null); await reload(); toast(`Moved ${y.name} to ${to === "reference" ? "the reference, in the Brief" : "Yarn"}`); }
        }} />
      <CropDialog y={cropping} onOpenChange={(o) => !o && setCropping(null)} onDone={async (made) => { setCropping(null); await reload(); toast(`Cut out ${made.name}, in ${made.shelf === "reference" ? "the reference" : "Yarn"}`); }} />
      <NewCopyDialog open={copyOpen} onOpenChange={setCopyOpen} projectId={projectId} folder={kit.here} shelf={shelf} onDone={reload} />
      <FromUrlDialog open={urlOpen} onOpenChange={setUrlOpen} projectId={projectId} folder={kit.here} shelf={shelf} onDone={reload} />
      <ConfirmDialog open={bulkDelete} onOpenChange={setBulkDelete} title={`Delete ${counted(picked.length, section)}?`} description="You can undo it for a while. Patterns that use them will show a missing-yarn marker." confirmLabel="Delete"
        onConfirm={async () => { for (const y of picked) await api.yarn.remove(y.id); setSelected(new Set()); await reload(); toast("Deleted"); }} />
      <FolderDialogs kit={kit} />
    </div>
  );
}

function YarnDrawer({ id, projectId, onClose, onChanged, onDelete, onMove, onCrop, onShelf }: { id: string | null; projectId: string; onClose: () => void; onChanged: () => void; onDelete: (y: Yarn) => Promise<void>; onMove: (y: Yarn) => void; onCrop: (y: Yarn) => void; onShelf: (y: Yarn) => void }) {
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
          <p className="eyebrow" style={{ marginTop: 4 }}>{KIND_WORD[y.kind]}{y.shelf === "reference" ? ", in the reference" : ""}</p>
          {y.kind === "pdf" ? <PdfPages y={y} /> : y.meta.site ? <SitePicture y={y} /> : (
          <div style={{ borderRadius: "var(--radius-md)", overflow: "hidden", background: "var(--surface-sunken)", maxHeight: 320, display: "grid", placeItems: "center" }}>
            {y.kind === "video" ? <video src={yarnFileUrl(y)} controls preload="metadata" poster={y.meta.thumb ? yarnThumbUrl(y) : undefined} style={{ width: "100%", maxHeight: 320 }} />
              : y.kind === "audio" ? <div style={{ width: "100%", padding: 16 }}><div style={{ height: 70 }}>{y.meta.peaks && <Waveform peaks={y.meta.peaks} />}</div><audio src={yarnFileUrl(y)} controls style={{ width: "100%", marginTop: 8 }} /></div>
              : <div style={{ width: "100%", height: y.kind === "image" ? 320 : 180 }}><YarnThumb y={y} large /></div>}
          </div>
          )}
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
            {y.meta.site && <><dt style={{ color: "var(--ink-muted)" }}>Page</dt><dd style={{ margin: 0, wordBreak: "break-all" }}><a className="link" href={y.meta.site.url} target="_blank" rel="noreferrer">{y.meta.site.url}</a>, on a {y.meta.site.device === "mobile" ? "phone" : "desktop"}, {timeAgo(y.meta.site.at)}</dd></>}
            {y.meta.from && <><dt style={{ color: "var(--ink-muted)" }}>Cut from</dt><dd style={{ margin: 0 }}>{y.meta.from.name}{y.meta.from.page ? `, page ${y.meta.from.page}` : ""}</dd></>}
            <dt style={{ color: "var(--ink-muted)" }}>Folder</dt>
            <dd style={{ margin: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {y.folder ? spoken(y.folder) : y.shelf === "reference" ? "The top of the reference" : "The top of Yarn"}
              <button type="button" className="link" onClick={() => onMove(y)}>Move</button>
            </dd>
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
            {(y.kind === "image" || y.kind === "pdf") && <Button tip="Cut a part of it out as a new picture, to use in a pattern" onClick={() => onCrop(y)}><Crop size={14} aria-hidden /> Cut out a part</Button>}
            <Button tip={y.shelf === "yarn" ? "For your model to look at and read about the business, not to put in a pattern" : "To put it in a pattern"} onClick={() => onShelf(y)}><BookOpen size={14} aria-hidden /> {y.shelf === "yarn" ? "Move to the Brief" : "Move to Yarn"}</Button>
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

function NewCopyDialog({ open, onOpenChange, projectId, folder, shelf, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; folder: string; shelf: Shelf; onDone: () => void }) {
  const [name, setName] = useState(""); const [text, setText] = useState(""); const [err, setErr] = useState<string | undefined>();
  const note = shelf === "reference";
  const save = async () => { try { await api.yarn.copy(projectId, { name: name || SHELF[shelf].copyName, text, folder, shelf }); onOpenChange(false); setName(""); setText(""); setErr(undefined); onDone(); } catch (e) { setErr((e as Error).message); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={SHELF[shelf].copy} description={note ? "Something to know about the business: opening hours, a story, what is new. Your model reads it when it builds the profile." : "Headlines, captions, hashtags: words you want to reuse across posts."}
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={save}>{note ? "Save note" : "Save copy"}</Button></>}>
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label="Name" htmlFor="nc-name"><Input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={note ? "Opening hours" : "Launch headlines"} /></Field>
        <Field label="Text" htmlFor="nc-text" error={err} hint={`${text.length} characters`}><Textarea id="nc-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function FromUrlDialog({ open, onOpenChange, projectId, folder, shelf, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; folder: string; shelf: Shelf; onDone: () => void }) {
  const [url, setUrl] = useState(""); const [err, setErr] = useState<string | undefined>(); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await api.yarn.fromUrl(projectId, url, folder, shelf); onOpenChange(false); setUrl(""); setErr(undefined); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add from a link" description="knitted fetches this one file when you press Add. Nothing else is contacted."
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={busy || !url} onClick={go}>{busy ? "Fetching..." : "Add"}</Button></>}>
      <Field label="Link" htmlFor="fu-url" error={err}><Input id="fu-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/logo.png" onKeyDown={(e) => e.key === "Enter" && url && go()} /></Field>
    </Dialog>
  );
}

/** A PDF a page at a time, with its words a press away. */
function PdfPages({ y }: { y: Yarn }) {
  const n = y.meta.pages ?? 1;
  const [page, setPage] = useState(1);
  const [reading, setReading] = useState(false);
  const { data: text } = useLive(() => (reading ? api.yarn.text(y.id) : Promise.resolve(null)), [y.id, y.hash, reading]);
  const at = Math.min(page, n);
  return (
    <div style={{ display: "grid", gap: "var(--space-2)" }}>
      <div style={{ borderRadius: "var(--radius-md)", overflow: "auto", background: "var(--surface-sunken)", height: 380, display: "grid", placeItems: "center" }}>
        {reading
          ? <p className="body-sm" style={{ margin: 0, padding: "var(--space-3)", whiteSpace: "pre-wrap", alignSelf: "start", justifySelf: "stretch" }}>{text ? text.pages[at - 1]?.trim() || "This page has no words in it: it is a picture, like a scan." : "Reading..."}</p>
          : <img src={pdfPageUrl(y, at, 800)} alt={`Page ${at} of ${y.name}`} style={{ maxWidth: "100%", maxHeight: 380, objectFit: "contain", background: "#fff" }} />}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <IconButton label="Page before" disabled={at <= 1} onClick={() => setPage(at - 1)}><ChevronLeft size={16} /></IconButton>
          <span className="body-sm" aria-live="polite">Page {at} of {n}</span>
          <IconButton label="Next page" disabled={at >= n} onClick={() => setPage(at + 1)}><ChevronRight size={16} /></IconButton>
        </div>
        <Button size="sm" variant="ghost" tip={reading ? "See the page as it looks" : "Read the words on this page, as your model does"} onClick={() => setReading(!reading)}>{reading ? "Show the page" : "Read its words"}</Button>
      </div>
    </div>
  );
}

/** A picture of a whole web page: tall, so it scrolls, from the top. */
function SitePicture({ y }: { y: Yarn }) {
  return (
    <div style={{ borderRadius: "var(--radius-md)", overflow: "auto", background: "var(--surface-sunken)", maxHeight: 460 }}>
      <img src={yarnFileUrl(y)} alt={`${y.name}, the whole page`} style={{ display: "block", width: y.meta.site?.device === "mobile" ? "60%" : "100%", margin: "0 auto" }} />
    </div>
  );
}

/**
 * Cut a part of a picture, or of a PDF's page, out as a new picture: drag over it to frame the
 * part, or type where it is. In Yarn unless the person puts it in the reference.
 */
function CropDialog({ y, onOpenChange, onDone }: { y: Yarn | null; onOpenChange: (o: boolean) => void; onDone: (made: Yarn) => void }) {
  const [page, setPage] = useState(1);
  const [box, setBox] = useState<CropBox>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [name, setName] = useState("");
  const [to, setTo] = useState<Shelf>("yarn");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    // A new file to cut from starts again: the whole page framed, and the first page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1); setBox({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }); setName(""); setTo("yarn"); setErr(undefined);
  }, [y?.id]);
  if (!y) return null;
  const n = y.kind === "pdf" ? y.meta.pages ?? 1 : 1;
  const src = y.kind === "pdf" ? pdfPageUrl(y, page, 1600) : yarnFileUrl(y);
  const at = (e: React.PointerEvent) => { const r = area.current!.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  const pct = (v: number) => Math.round(v * 1000) / 10;
  const field = (k: keyof CropBox, label: string) => (
    <Field label={label} htmlFor={`crop-${k}`}>
      <Input id={`crop-${k}`} type="number" min={0} max={100} step={0.5} value={pct(box[k])} onChange={(e) => { const v = Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100; setBox((b) => ({ ...b, [k]: v })); }} />
    </Field>
  );
  const save = async () => {
    setBusy(true); setErr(undefined);
    try { const r = await api.yarn.crop(y.id, { box, ...(y.kind === "pdf" ? { page } : {}), ...(name.trim() ? { name: name.trim() } : {}), shelf: to }); onDone(r.yarn); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!y} onOpenChange={onOpenChange} wide title={`Cut out a part of ${y.name}`} description="Drag over the part to keep. The original stays as it is."
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}><Crop size={14} aria-hidden /> {busy ? "Cutting..." : "Cut it out"}</Button></>}>
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        {n > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <IconButton label="Page before" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></IconButton>
            <span className="body-sm" aria-live="polite">Page {page} of {n}</span>
            <IconButton label="Next page" disabled={page >= n} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></IconButton>
          </div>
        )}
        <div style={{ display: "grid", placeItems: "center", background: "var(--surface-sunken)", borderRadius: "var(--radius-md)", padding: "var(--space-2)", maxHeight: "52vh", overflow: "auto" }}>
          <div ref={area} className="crop-area" style={{ position: "relative", touchAction: "none", cursor: "crosshair", userSelect: "none" }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); drag.current = p; setBox({ x: p.x, y: p.y, w: 0, h: 0 }); }}
            onPointerMove={(e) => { if (!drag.current) return; const p = at(e), o = drag.current; setBox({ x: Math.min(o.x, p.x), y: Math.min(o.y, p.y), w: Math.abs(p.x - o.x), h: Math.abs(p.y - o.y) }); }}
            onPointerUp={() => { drag.current = null; }}>
            <img src={src} alt="" draggable={false} style={{ display: "block", maxWidth: "100%", maxHeight: "48vh", background: "#fff" }} />
            <div aria-hidden className="crop-box" style={{ position: "absolute", left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />
          </div>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: "var(--space-3)", gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          <legend className="label" style={{ marginBottom: 6 }}>The part to keep, in percent from the top left</legend>
          {field("x", "From the left")}{field("y", "From the top")}{field("w", "Width")}{field("h", "Height")}
        </fieldset>
        <div style={{ display: "grid", gap: "var(--space-3)", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "end" }}>
          <Field label="Name" htmlFor="crop-name" error={err}><Input id="crop-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={y.kind === "pdf" ? `${y.name}, page ${page}` : `${y.name}, cropped`} /></Field>
          <SegmentedControl<Shelf> label="Put it in" value={to} onChange={setTo} options={[{ value: "yarn", label: "Yarn" }, { value: "reference", label: "Reference" }]} />
        </div>
      </div>
    </Dialog>
  );
}

void Plus; void Menu; void Tip;
