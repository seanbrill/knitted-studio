"use client";

// A knit, open: the picture on the left, kept in view, and on the right what to do with it, a
// tab at a time: its post, its versions, its formats, its comments and its details. A knit is
// one, however many times it was knitted: each change your model makes is a version here, not
// another card in Knits, and the same picture at 2x or as a JPEG is a format of it.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, knitFileUrl, type KnitIssue, type KnitRecord } from "@knitted/core/client";
import { Button, Chip, ConfirmDialog, IconButton, Input, Menu, SegmentedControl, TabPanel, Tabs, Viewer, icons, useToast, type MenuItems } from "@knitted/ui";
import { formatBytes, timeAgo, useLive } from "@/lib/hooks";
import { KnitPost } from "./KnitPost";
import { AskModelButton, aboutKnit } from "./AskModel";
import { CommentThreads, PinCatch, Pins, shownThreads, useCommentState, useComments, type CommentsOn } from "./Comments";

const { ChevronLeft, ChevronRight, ChevronDown, Star, Download, Copy, Send, MoreHorizontal, FolderInput, Trash2, Check, AlertTriangle, X, MessageSquare } = icons;

type Tab = "post" | "versions" | "formats" | "comments" | "details";
type Pick = { kind: "image" | "video"; format: string; scale: number };
/** A file's type and scale, as people say it: PNG, JPEG 2x, MP4. */
/** "PNG", "JPEG 2x", "MP4 60 fps": which file of a version it is. */
export const formatName = (f: { format: string; scale: number; fps?: number; kind?: string; report?: { fps?: number } }) => {
  const fps = f.fps ?? (f.kind === "video" && f.report?.fps && f.report.fps !== 30 ? f.report.fps : undefined);
  return `${f.format === "jpeg" || f.format === "jpg" ? "JPEG" : f.format === "webp" ? "WebP" : f.format.toUpperCase()}${f.scale > 1 ? ` ${f.scale}x` : ""}${fps ? ` ${fps} fps` : ""}`;
};
const dims = (f: { width: number; height: number }) => `${f.width} × ${f.height}`;
/** Download what is at `href`, as a link pressed would. */
export const saveHref = (href: string) => { const a = document.createElement("a"); a.href = href; a.rel = "noopener"; document.body.append(a); a.click(); a.remove(); };

export function KnitView({ knit, here, onOpen, onClose, onChanged, onMove, onPost, onFavorite }: {
  knit: KnitRecord;
  /** The knits listed where it was opened, in their order, to step through. */
  here: KnitRecord[];
  onOpen: (k: KnitRecord) => void; onClose: () => void; onChanged: () => void;
  onMove: (k: KnitRecord) => void; onPost: (k: KnitRecord) => void; onFavorite: (k: KnitRecord) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("post");
  const { data: info, refresh: refreshVersions } = useLive(() => api.knit.versions(knit.id), [knit.id]);
  const versions = info?.versions ?? [];
  // The file on the stage: the one shown for the knit, unless an earlier version or another format was picked.
  // Kept with the knit it was picked in, so stepping to the next knit shows that one's own.
  const [picked, setPicked] = useState<{ of: string; id: string } | null>(null);
  const of = knit.unit ?? knit.id;
  const viewingId = picked?.of === of ? picked.id : null;
  const setViewingId = (id: string | null) => setPicked(id ? { of, id } : null);
  const files = versions.flatMap((v) => v.files);
  const viewing = (viewingId && files.find((f) => f.id === viewingId)) || files.find((f) => f.id === knit.id) || knit;
  const version = versions.find((v) => v.files.some((f) => f.id === viewing.id));
  const current = versions.find((v) => v.no === info?.current);
  const other = !!version && !!current && version.no !== current.no;
  const changed = async () => { await refreshVersions(); onChanged(); };

  // Comments are on the file looked at: a pin on version 2 is about version 2.
  const video = viewing.kind === "video";
  const on: CommentsOn = { kind: "knit", projectId: viewing.projectId, knitId: viewing.id, label: knit.label, patternId: knit.patternId, video };
  const { threads, refresh: refreshThreads } = useComments(on);
  const c = useCommentState();
  const { setDraft, setPicking, setActive } = c;
  useEffect(() => { setDraft(null); setPicking(false); setActive(null); }, [viewing.id, setDraft, setPicking, setActive]);
  const player = useRef<HTMLVideoElement>(null);
  const [at, setAt] = useState(0);
  const openThreads = threads.filter((t) => !t.resolvedAt).length;

  // Step through the knits listed where it was opened, with the arrows or ← and →.
  const at0 = here.findIndex((k) => k.id === knit.id || (!!k.unit && k.unit === knit.unit));
  const prev = at0 > 0 ? here[at0 - 1] : undefined, next = at0 >= 0 && at0 < here.length - 1 ? here[at0 + 1] : undefined;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, video, audio, [role=tablist], [role=menu], [role=listbox], [contenteditable=true]")) return;
      const to = e.key === "ArrowLeft" ? prev : next;
      if (to) { e.preventDefault(); onOpen(to); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [prev, next, onOpen]);

  const choose = async (f: KnitRecord, said: string) => {
    try { await api.knit.choose(f.id); setViewingId(null); await changed(); toast(said); } catch (e) { toast.problem((e as Error).message); }
  };
  const [confirm, setConfirm] = useState<null | { id: string; what: "file" | "version" | "earlier" | "all"; title: string; description: string; label: string }>(null);
  const copyPicture = async () => {
    try { const blob = await (await fetch(knitFileUrl(viewing))).blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); toast("Copied. Paste it anywhere."); }
    catch { toast("Your browser would not copy that. Use Download instead."); }
  };
  const caption = knit.post.caption ? [knit.post.caption, (knit.post.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n") : "";
  const n = versions.length;
  const earlierBytes = versions.filter((v) => v !== current).reduce((s, v) => s + v.files.reduce((m, f) => m + f.bytes, 0), 0);
  // With an older one picked, the rest are not all earlier.
  const others = current?.no === n ? "earlier" : "other";
  const sizeName = info?.size.name ?? "";
  const place = knit.folder ? knit.folder.split("/").join(" / ") : "Knits";

  const more: MenuItems = [
    { label: "Move to folder", icon: <FolderInput size={14} aria-hidden />, onSelect: () => onMove(knit) },
    ...(viewing.kind === "image" ? [{ label: "Copy the picture", icon: <Copy size={14} aria-hidden />, onSelect: () => void copyPicture() }] : []),
    "separator",
    { label: n > 1 || files.length > 1 ? "Delete this knit, every version" : "Delete this knit", icon: <Trash2 size={14} aria-hidden />, danger: true,
      onSelect: () => setConfirm({ id: knit.id, what: "all", title: `Delete ${knit.label}?`, description: files.length > 1 ? `Its ${files.length} files go: every version and format. You can knit it again from its pattern.` : "The file is removed from disk. You can knit it again from its pattern.", label: files.length > 1 ? `Delete ${files.length} files` : "Delete the file" }) },
  ];

  return (
    <Viewer open onOpenChange={(o) => !o && onClose()} title={knit.label}
      sub={<>{[sizeName && info ? `${sizeName} ${info.size.w}×${info.size.h}` : `${knit.width}×${knit.height}`, place].join(" · ")}</>}
      lead={<>
        <IconButton label="The knit before" disabled={!prev} onClick={() => prev && onOpen(prev)}><ChevronLeft size={16} /></IconButton>
        <IconButton label="The next knit" disabled={!next} onClick={() => next && onOpen(next)}><ChevronRight size={16} /></IconButton>
        {at0 >= 0 && here.length > 1 && <span className="viewer-count">{at0 + 1} of {here.length}</span>}
      </>}
      trail={<button type="button" className="knit-star in-row" style={{ opacity: 1 }} aria-pressed={knit.favorite} aria-label={`Favourite ${knit.label}`} title={knit.favorite ? "A favourite. Press to take it off." : "Add to your favourites"} onClick={() => onFavorite(knit)}><Star size={17} fill={knit.favorite ? "currentColor" : "none"} aria-hidden /></button>}
      footer={<>
        {knit.patternId && <Link className="btn btn-ghost" href={`/projects/${knit.projectId}/patterns/${knit.patternId}`}>Open the pattern</Link>}
        <AskModelButton about={aboutKnit(knit)} variant="ghost" />
        <span className="grow" />
        <Menu trigger={<Button variant="ghost" aria-label="More for this knit"><MoreHorizontal size={15} aria-hidden /> More</Button>} items={more} />
        {caption && <Button onClick={async () => { await navigator.clipboard.writeText(caption); toast("Caption and hashtags copied."); }}><Copy size={14} aria-hidden /> Copy caption</Button>}
        <span className="split-btn">
          <a className="btn btn-secondary" href={knitFileUrl(viewing, true)}><Download size={14} aria-hidden /> Download {version && version.files.length > 1 ? formatName(viewing) : ""}</a>
          {version && version.files.length > 1 && <Menu trigger={<button type="button" className="btn btn-secondary" aria-label="Download another format"><ChevronDown size={14} /></button>}
            items={[...version.files.map((f) => ({ label: `${formatName(f)}, ${dims(f)}, ${formatBytes(f.bytes)}`, icon: <Download size={14} aria-hidden />, onSelect: () => saveHref(knitFileUrl(f, true)) })), "separator", { label: `All ${version.files.length}, as a zip`, onSelect: () => saveHref(`/api/projects/${knit.projectId}/knits/zip?ids=${version.files.map((f) => f.id).join(",")}`) }]} />}
        </span>
        <Button variant="primary" onClick={() => onPost(viewing)}><Send size={14} aria-hidden /> Post</Button>
      </>}>

      <div className="viewer-stage">
        {other && version && current ? (
          <div className="viewer-banner" role="status">
            <span>Version {version.no} of {n}, knitted {timeAgo(version.createdAt)}. Knits shows version {current.no}.</span>
            <Button size="sm" variant="ghost" onClick={() => setViewingId(null)}>Back to the current one</Button>
            <Button size="sm" onClick={() => void choose(version.files[0]!, `Version ${version.no} is the one shown now`)}><Check size={13} aria-hidden /> Use this one</Button>
          </div>
        ) : <span />}
        <div className="viewer-media" data-other={other || undefined}>
          <div className="pin-media" data-picking={c.picking || undefined}>
            {video
              ? <video key={viewing.id} ref={player} src={knitFileUrl(viewing)} controls onTimeUpdate={(e) => setAt(e.currentTarget.currentTime * 1000)} onSeeked={(e) => setAt(e.currentTarget.currentTime * 1000)} />
              : <img key={viewing.id} src={knitFileUrl(viewing)} alt={knit.label} />}
            <Pins threads={shownThreads(threads, c)} draft={c.draft} active={c.active} at={video ? at : undefined}
              onPick={(t) => { setTab("comments"); c.setActive(t.id); if (t.timeMs != null && player.current) { player.current.pause(); player.current.currentTime = t.timeMs / 1000; } }} />
            {c.picking && !c.draft && <PinCatch label={`Place comment here${video ? ", at this moment" : ""}`} onSpot={(x, y) => { player.current?.pause(); c.setDraft({ x, y, ...(video ? { timeMs: Math.round((player.current?.currentTime ?? 0) * 1000) } : {}) }); c.setActive(null); }} />}
          </div>
        </div>
        <p className="viewer-caption">
          {n > 1 && version ? `Version ${version.no} of ${n} · ` : ""}{formatName(viewing)} {dims(viewing)} · knitted {timeAgo(viewing.createdAt)}
          {" · "}{c.picking ? "Click the spot the comment is about" : <button type="button" className="link" onClick={() => { setTab("comments"); c.setPicking(true); c.setActive(null); }}>Pin a comment</button>}
        </p>
      </div>

      <div className="viewer-pane">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} tabs={[
          { value: "post", label: "Post" },
          { value: "versions", label: "Versions", count: n > 1 ? n : undefined },
          { value: "formats", label: "Formats", count: (version?.files.length ?? 1) > 1 ? version!.files.length : undefined },
          { value: "comments", label: "Comments", count: openThreads || undefined },
          { value: "details", label: "Details" },
        ]}>
          <TabPanel value="post" className="viewer-panel">
            <KnitPost knit={knit} onChanged={() => void changed()} />
          </TabPanel>

          <TabPanel value="versions" className="viewer-panel">
            {n === 1 && <p className="body-sm muted" style={{ margin: 0 }}>Ask your model for a change, or change the pattern and knit it again: the new one comes in here as version 2, and Knits shows it in this one&apos;s place. This one stays here, to go back to.</p>}
            <ol className="kv-list" aria-label="Versions, newest first">
              {[...versions].reverse().map((v) => {
                const shown = v.files[0]!, isCurrent = v.no === current?.no, looking = v.no === version?.no;
                const items: MenuItems = [
                  ...(!isCurrent ? [{ label: "Use this one", icon: <Check size={14} aria-hidden />, onSelect: () => void choose(shown, `Version ${v.no} is the one shown now`) }] : []),
                  { label: "Download", icon: <Download size={14} aria-hidden />, onSelect: () => saveHref(knitFileUrl(shown, true)) },
                  ...(n > 1 ? ["separator" as const, { label: "Delete this version", icon: <Trash2 size={14} aria-hidden />, danger: true, onSelect: () => setConfirm({ id: shown.id, what: "version", title: `Delete version ${v.no}?`, description: `${v.files.length === 1 ? "Its file goes" : `Its ${v.files.length} files go`}, ${formatBytes(v.files.reduce((m, f) => m + f.bytes, 0))}.${isCurrent ? " The version before it is shown in its place." : ""}`, label: "Delete the version" }) }] : []),
                ];
                return (
                  <li key={v.look} className="kv-row" data-active={looking || undefined}>
                    <button type="button" className="kv-pick" aria-pressed={looking} onClick={() => setViewingId(isCurrent ? null : shown.id)}>
                      <span className="kv-thumb" aria-hidden>{shown.kind === "image" ? <img src={knitFileUrl(shown)} alt="" loading="lazy" /> : <video src={knitFileUrl(shown)} muted preload="metadata" />}</span>
                      <span className="kv-text">
                        <span className="kv-name">Version {v.no}{isCurrent && <span className="kv-badge" data-tone="current">Current</span>}{looking && !isCurrent && <span className="kv-badge">Looking at it</span>}</span>
                        <small>Knitted {timeAgo(v.createdAt)} · {v.files.map(formatName).join(", ")} · {formatBytes(v.files.reduce((m, f) => m + f.bytes, 0))}</small>
                      </span>
                    </button>
                    <Menu trigger={<IconButton label={`More for version ${v.no}`}><MoreHorizontal size={16} /></IconButton>} items={items} />
                  </li>
                );
              })}
            </ol>
            {n > 1 && current && (
              <div className="kv-foot">
                <span>{n - 1 === 1 ? `1 ${others} version` : `${n - 1} ${others} versions`}, {formatBytes(earlierBytes)}</span>
                <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: current.files[0]!.id, what: "earlier", title: `Delete the ${n - 1 === 1 ? `${others} version` : `${n - 1} ${others} versions`}?`, description: `Version ${current.no} stays, and every file of the ${n - 1 === 1 ? "other one" : "others"} goes: ${formatBytes(earlierBytes)}.`, label: "Delete them" })}><Trash2 size={13} aria-hidden /> Delete the {others} versions</Button>
              </div>
            )}
          </TabPanel>

          <TabPanel value="formats" className="viewer-panel">
            {version && <FormatsTab knit={knit} files={version.files} isCurrent={!other} size={info?.size} row={info?.row ?? null} versionNo={version.no} versions={n}
              onUse={(f) => void choose(f, `${formatName(f)} is the one shown and posted now`)}
              onDelete={(f) => setConfirm({ id: f.id, what: "file", title: `Delete the ${formatName(f)}?`, description: `${dims(f)}, ${formatBytes(f.bytes)}. The other ${version.files.length - 1 === 1 ? "format stays" : "formats stay"}.`, label: "Delete the file" })} />}
          </TabPanel>

          <TabPanel value="comments" className="viewer-panel">
            {other && version && <p className="body-sm muted" style={{ margin: 0 }}>The comments on version {version.no}.</p>}
            <CommentThreads on={on} threads={threads} c={c} refresh={refreshThreads} wholeWords={video ? "video" : "knit"} heading={false}
              moment={video ? () => (player.current ? player.current.currentTime * 1000 : 0) : undefined}
              hint={video ? "Find the moment with the controls, then click the spot that should change." : "Click the spot on the picture that should change."}
              onGo={(t) => { if (t.timeMs != null && player.current) { player.current.pause(); player.current.currentTime = t.timeMs / 1000; } }} />
          </TabPanel>

          <TabPanel value="details" className="viewer-panel">
            <Details knit={knit} file={viewing} onMove={() => onMove(knit)} onChanged={() => void changed()} />
          </TabPanel>
        </Tabs>
      </div>

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.title ?? ""} description={confirm?.description} confirmLabel={confirm?.label ?? "Delete"}
        onConfirm={async () => {
          const d = confirm!;
          try {
            const r = await api.knit.remove(d.id, d.what);
            if (d.what === "all") { toast(`Deleted ${knit.label}`); onChanged(); onClose(); return; }
            setViewingId(null); await changed();
            toast(`Deleted ${r.deleted === 1 ? "1 file" : `${r.deleted} files`}, ${formatBytes(r.bytes)}`);
          } catch (e) { toast.problem((e as Error).message); }
        }} />
    </Viewer>
  );
}

/** A version's files, the one shown and posted first, and another one to knit. */
function FormatsTab({ knit, files, isCurrent, size, row, versionNo, versions, onUse, onDelete }: {
  knit: KnitRecord; files: KnitRecord[]; isCurrent: boolean; size?: { name: string; w: number; h: number }; row: number | null; versionNo: number; versions: number;
  onUse: (f: KnitRecord) => void; onDelete: (f: KnitRecord) => void;
}) {
  const toast = useToast();
  const kind = files[0]!.kind;
  const [pick, setPick] = useState<Pick>(() => ({ kind, format: kind === "video" ? "mp4" : files.some((f) => f.format === "jpeg") ? "png" : "jpeg", scale: 1 }));
  const [busy, setBusy] = useState(false);
  const have = files.some((f) => f.format === pick.format && f.scale === pick.scale);
  // Knitting makes the pattern as it is now: when it has changed since, that is a new version, not a format of this one.
  const newVersion = !isCurrent || !!knit.patternChangedSince;
  const why = !knit.patternId ? "Its pattern is gone, so it cannot be knitted again." : row != null ? "This is one row of a batch: knit the batch again from its pattern for another format." : null;
  const start = async () => {
    if (!knit.patternId || !size) return;
    setBusy(true);
    try {
      await api.knit.start(knit.patternId, { sizes: [size], format: pick.format as "png" | "jpeg" | "webp" | "mp4", scale: pick.scale as 1 | 2 });
      toast(newVersion ? "Knitting it. It comes in as a new version." : `Knitting the ${formatName(pick)}. It shows here when it is done.`);
    } catch (e) { toast.problem((e as Error).message); } finally { setBusy(false); }
  };
  return <>
    <ul className="kv-list" aria-label={`The files of version ${versionNo}`}>
      {files.map((f, i) => (
        <li key={f.id} className="kv-row kv-format">
          <span className="kv-text">
            <span className="kv-name">{formatName(f)}<span className="kv-dims">{dims(f)}</span>{i === 0 && isCurrent && <span className="kv-badge" data-tone="current">Shown and posted</span>}</span>
            <small>{formatBytes(f.bytes)}{f.durationMs ? ` · ${(f.durationMs / 1000).toFixed(1)} s` : ""} · knitted {timeAgo(f.createdAt)}</small>
          </span>
          {i > 0 && isCurrent && <Button size="sm" variant="ghost" tip="Show this one in Knits, and post it" onClick={() => onUse(f)}>Use this one</Button>}
          <a className="btn btn-secondary btn-sm" href={knitFileUrl(f, true)} aria-label={`Download the ${formatName(f)}`}><Download size={13} aria-hidden /> Download</a>
          {files.length > 1 && <IconButton label={`Delete the ${formatName(f)}`} onClick={() => onDelete(f)}><Trash2 size={14} /></IconButton>}
        </li>
      ))}
    </ul>
    {files.length > 1 && <a className="link body-sm" href={`/api/projects/${knit.projectId}/knits/zip?ids=${files.map((f) => f.id).join(",")}`}>Download all {files.length}, as a zip</a>}
    <section className="kv-card" aria-label="Knit another format">
      <p className="label" style={{ margin: 0 }}>Knit another format</p>
      {why ? <p className="body-sm muted" style={{ margin: 0 }}>{why}</p> : <>
        {kind === "image" && <SegmentedControl label="Type" value={pick.format} onChange={(format) => setPick((p) => ({ ...p, format }))} options={[{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }, { value: "webp", label: "WebP" }]} />}
        <SegmentedControl label="Scale" value={String(pick.scale)} onChange={(s) => setPick((p) => ({ ...p, scale: Number(s) }))} options={[{ value: "1", label: "1x" }, { value: "2", label: "2x" }]} />
        <p className="body-sm muted" style={{ margin: 0 }}>
          {have ? `Version ${versionNo} has this one already: ${formatName(pick)}, ${files.find((f) => f.format === pick.format && f.scale === pick.scale)!.width} × ${files.find((f) => f.format === pick.format && f.scale === pick.scale)!.height}.` : newVersion
            ? `The pattern has changed since version ${versionNo}, so this knits it as it is now: ${versions > 1 ? `version ${versions + 1}` : "a new version"}.`
            : `${pick.format === "jpeg" ? "A smaller file, with no see-through parts. " : pick.format === "webp" ? "Smaller still, for websites. " : ""}${pick.scale === 2 ? `${(size?.w ?? 0) * 2} × ${(size?.h ?? 0) * 2}, sharp on big screens.` : `${size?.w ?? ""} × ${size?.h ?? ""}.`}`}
        </p>
        <Button size="sm" busy={busy} disabled={have && !newVersion} onClick={() => void start()} style={{ justifySelf: "start" }}>Knit it</Button>
      </>}
    </section>
  </>;
}

/** What it is, where it came from, where it is filed, its tags, and the checks it passed. */
function Details({ knit, file, onMove, onChanged }: { knit: KnitRecord; file: KnitRecord; onMove: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [tag, setTag] = useState("");
  const retag = async (tags: string[]) => { try { await api.knit.tag(knit.id, tags); onChanged(); } catch (e) { toast.problem((e as Error).message); } };
  const issues: KnitIssue[] = file.report.issues ?? [];
  const checks = file.report.checks ?? [];
  return <>
    <dl className="kv-details">
      <div><dt>File</dt><dd>{formatName(file)}, {dims(file)}, {formatBytes(file.bytes)}{file.durationMs ? `, ${(file.durationMs / 1000).toFixed(1)} seconds` : ""}</dd></div>
      <div><dt>Knitted</dt><dd>{timeAgo(file.createdAt)} <span className="muted">({new Date(file.createdAt).toLocaleString()})</span></dd></div>
      <div><dt>Pattern</dt><dd>{knit.patternId ? <Link className="link" href={`/projects/${knit.projectId}/patterns/${knit.patternId}`}>{knit.patternName}</Link> : <>{knit.patternName}, deleted</>}{knit.patternChangedSince && <span className="muted"> · changed since this was knitted</span>}</dd></div>
      <div><dt>Folder</dt><dd>{knit.folder ? knit.folder.split("/").join(" / ") : "The top of Knits"} <button type="button" className="link" onClick={onMove}>Move</button></dd></div>
      {file.report.lufs != null && <div><dt>Sound</dt><dd>{file.report.lufs.toFixed(1)} LUFS{file.report.truePeak != null ? `, peaks at ${file.report.truePeak.toFixed(1)} dBTP` : ""}</dd></div>}
      <div><dt>Tags</dt><dd>
        <span className="tag-chips">
          {knit.tags.map((t) => <Chip key={t}>{t}<button className="icon-btn" style={{ width: 18, height: 18 }} aria-label={`Remove tag ${t}`} onClick={() => void retag(knit.tags.filter((x) => x !== t))}><X size={11} /></button></Chip>)}
          <span style={{ width: 150 }}><Input aria-label="Add a tag" value={tag} placeholder="Add a tag" onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tag.trim()) { void retag([...knit.tags, tag]); setTag(""); } }} /></span>
        </span>
      </dd></div>
    </dl>
    {(issues.length > 0 || checks.length > 0) && (
      <section aria-label="Checks" style={{ display: "grid", gap: 8 }}>
        <p className="label" style={{ margin: 0 }}>Checks</p>
        <ul className="kv-checks">
          {issues.map((i, n) => <li key={`i${n}`} data-level={i.level}><AlertTriangle size={14} aria-hidden /><span>{i.message}</span></li>)}
          {checks.map((t, n) => <li key={`c${n}`} data-level="ok"><Check size={14} aria-hidden /><span>{t}</span></li>)}
        </ul>
      </section>
    )}
    <p className="body-sm muted" style={{ margin: 0 }}><MessageSquare size={12} aria-hidden style={{ verticalAlign: -1 }} /> Something to change? Pin a comment to the spot, or ask your model.</p>
  </>;
}
