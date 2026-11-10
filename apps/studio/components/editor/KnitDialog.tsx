"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, knitFileUrl, type JobItem, type KnitParams, type KnitUnitPreview } from "@knitted/core/client";
import { SIZES, type Pattern } from "@knitted/core";
import { Button, Dialog, Field, SegmentedControl, Skeleton, StitchProgress, Switch, Textarea, icons, useToast } from "@knitted/ui";
import { useEditor } from "@/lib/editor/store";
import { SizeShape } from "../SizeTiles";
import { RendererCard } from "../RendererCard";

const { AlertTriangle, Check, X } = icons;
const TYPE: Record<string, string> = { png: "PNG", jpeg: "JPEG", webp: "WebP", mp4: "MP4" };
const ROWS_SHOWN = 8;

/** What a file comes back as, in a few words, before it is made. */
export function comesBackAs(u: Pick<KnitUnitPreview, "versions" | "look" | "current" | "same" | "kept">): string {
  if (!u.versions) return "new";
  const which = u.look === u.current ? "the one there" : u.look != null ? `version ${u.look}` : "a file there";
  if (u.kept) return u.look === u.current ? "the same as the one there: kept" : `the same as ${which}: shown again, not drawn`;
  if (u.same) return `the same as ${which}, drawn again`;
  if (u.look != null) return u.look === u.current ? "another format of the one there" : `another format of version ${u.look}`;
  return `version ${u.versions + 1} of this knit`;
}
/** A file that is already there as it is, so knitting it does nothing. */
const keptAsIs = (u: KnitUnitPreview) => u.kept && u.look === u.current;


/** Parse pasted spreadsheet text (tab or comma separated) into rows keyed by the header line. */
export function parseRows(text: string): { rows: Record<string, string>[]; headers: string[] } {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], headers: lines[0] ? split(lines[0]) : [] };
  const headers = split(lines[0]).map((h) => h.trim().toLowerCase());
  return { headers, rows: lines.slice(1).map((l) => { const cells = split(l); return Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()])); }) };
}
function split(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** `editorHref`: opened outside the editor, a problem with a stitch links to the pattern there instead of showing the stitch. */
export function KnitDialog({ open, onOpenChange, pattern, projectId, editorHref }: { open: boolean; onOpenChange: (o: boolean) => void; pattern: Pattern; projectId: string; editorHref?: string }) {
  const toast = useToast();
  const motion = pattern.durationMs > 0;
  const [format, setFormat] = useState<"png" | "jpeg" | "webp" | "mp4">(motion ? "mp4" : "png");
  const [scale, setScale] = useState<1 | 2>(1);
  const [fps, setFps] = useState<30 | 60>(30);
  const [sizes, setSizes] = useState<string[]>([pattern.size.name]);
  const [reuse, setReuse] = useState(true);
  const [batch, setBatch] = useState(false);
  const [text, setText] = useState("");
  const [units, setUnits] = useState<KnitUnitPreview[] | null>(null);
  const [job, setJob] = useState<JobItem | null>(null);
  const [busy, setBusy] = useState(false);
  // The first knit on a new computer: the browser it draws with is downloaded here, first.
  const [canDraw, setCanDraw] = useState(true);
  const watch = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const freeSlots = pattern.stitches.filter((s) => !s.locked && s.slot).map((s) => s.slot!);
  const parsed = useMemo(() => parseRows(text), [text]);
  const chosenSizes = useMemo(() => (sizes.length ? SIZES.filter((s) => sizes.includes(s.name)).concat(sizes.includes(pattern.size.name) && !SIZES.some((s) => s.name === pattern.size.name) ? [pattern.size] : []) : [pattern.size]), [sizes, pattern.size]);
  const params: KnitParams = useMemo(() => ({ sizes: chosenSizes, format: motion ? "mp4" : format, scale, ...(motion && fps === 60 ? { fps } : {}), reuse, rows: batch && parsed.rows.length ? parsed.rows : undefined }), [chosenSizes, format, scale, fps, reuse, batch, parsed, motion]);
  const total = (batch && parsed.rows.length ? parsed.rows.length : 1) * chosenSizes.length;

  // Check before knitting: cheap, no browser, so problems show up before anyone waits.
  useEffect(() => {
    if (!open || job) return;
    let live = true;
    const t = setTimeout(() => { api.knit.preview(pattern.id, params).then((r) => live && setUnits(r.units)).catch(() => live && setUnits(null)); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [open, job, pattern.id, params, pattern.version]);

  useEffect(() => () => clearInterval(watch.current), []);
  // Closing resets the dialog, so the next open starts from the options, not the last run.
  const close = (o: boolean) => { if (!o) { setJob(null); setUnits(null); clearInterval(watch.current); } onOpenChange(o); };

  const go = async () => {
    setBusy(true);
    try {
      const j = await api.knit.start(pattern.id, params);
      setJob(j);
      clearInterval(watch.current);
      watch.current = setInterval(async () => {
        const fresh = await api.knit.job(j.id).catch(() => null);
        if (!fresh) return;
        setJob(fresh);
        if (["done", "failed", "cancelled", "interrupted"].includes(fresh.status)) clearInterval(watch.current);
      }, 500);
    } catch (e) { toast.problem((e as Error).message); }
    finally { setBusy(false); }
  };

  const errors = units?.flatMap((u) => u.issues.filter((i) => i.level === "error")) ?? [];
  const finished = !!job && ["done", "failed", "cancelled", "interrupted"].includes(job.status);
  // The files it will draw: not the ones there already as they are.
  const kept = units?.filter(keptAsIs).length ?? 0;
  const making = units ? units.length - kept : total;
  const anyNew = units?.some((u) => !u.versions) ?? false, anyOld = units?.some((u) => u.versions > 0 && !keptAsIs(u)) ?? false;
  const note = errors.length ? "Fix what is marked first"
    : !units ? undefined
    : making === 0 ? "Each is the same as the one there. Turn off Reuse to draw them again."
    : [anyNew && anyOld ? "New ones come into Knits as knits of their own, the rest as their newest version" : anyOld ? `${making === 1 ? "It comes" : "Each comes"} into Knits as the newest version` : `${making === 1 ? "It comes" : "They come"} into Knits as new`, kept ? `${kept} kept as ${kept === 1 ? "it is" : "they are"}` : ""].filter(Boolean).join(" · ");
  const type = motion ? "mp4" : format;
  const custom = !SIZES.some((s) => s.name === pattern.size.name && s.w === pattern.size.w && s.h === pattern.size.h);
  const tiles = [...SIZES, ...(custom ? [pattern.size] : [])];
  const show = (stitchId: string) => { useEditor.getState().select([stitchId]); close(false); };

  return (
    <Dialog open={open} onOpenChange={close} size="lg" title={job ? (finished ? "Knit finished" : "Knitting...") : `Knit ${pattern.name}`} description={job ? undefined : "Real files from the pattern as it is now"}
      note={job ? undefined : note}
      actions={job ? (
        finished ? <><Button variant="ghost" onClick={() => close(false)}>Close</Button><Link href={`/projects/${projectId}/knits`} className="btn btn-primary">See your knits</Link></>
          : <Button variant="danger" onClick={() => api.knit.cancel(job.id)}>Cancel</Button>
      ) : (<><Button variant="ghost" onClick={() => close(false)}>Cancel</Button><Button variant="primary" busy={busy} disabled={!canDraw || errors.length > 0 || making === 0 || (batch && parsed.rows.length === 0)} onClick={go}>{making === 0 ? "Nothing new to knit" : `Knit ${making} ${making === 1 ? "file" : "files"}`}</Button></>)}>
      {!job ? (
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <RendererCard missingOnly onReady={setCanDraw} />
          <div className="knit-opts">
            <Field label="Type">
              <SegmentedControl label="Format" value={type} onChange={setFormat} options={motion ? [{ value: "mp4", label: "MP4 video" }] : [{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }, { value: "webp", label: "WebP" }]} />
            </Field>
            <Field label="Scale"><SegmentedControl<"1" | "2"> label="Scale" value={String(scale) as "1" | "2"} onChange={(v) => setScale(Number(v) as 1 | 2)} options={[{ value: "1", label: "1x" }, { value: "2", label: "2x, sharper" }]} /></Field>
            {motion && <Field label="Smoothness" hint={fps === 60 ? "Fast motion looks smoother. Takes about twice as long." : "The standard for social video. When most of the footage is shot at 24 or 25, the video keeps that rate, so it plays without a hitch."}><SegmentedControl<"30" | "60"> label="Frames a second" value={String(fps) as "30" | "60"} onChange={(v) => setFps(Number(v) as 30 | 60)} options={[{ value: "30", label: "30 fps" }, { value: "60", label: "60 fps" }]} /></Field>}
          </div>
          <div className="field">
            <span className="field-label" id="kd-sizes">Sizes</span>
            <div className="knit-sizes" role="group" aria-labelledby="kd-sizes">
              {tiles.map((s) => (
                <button key={s.name} type="button" className="knit-size" aria-pressed={sizes.includes(s.name)} title={`${s.w} × ${s.h}`} aria-label={`${s.name} ${s.w}x${s.h}`}
                  onClick={() => setSizes((cur) => (cur.includes(s.name) ? cur.filter((x) => x !== s.name) : [...cur, s.name]))}>
                  <SizeShape w={s.w} h={s.h} box={[26, 20]} />{s.name}
                </button>
              ))}
            </div>
          </div>

          <section aria-label="What it makes" aria-live="polite" className="field">
            <h3 className="field-label" style={{ margin: 0 }}>What it makes {units && <small className="knit-files-n">{units.length} {units.length === 1 ? "file" : "files"}</small>}</h3>
            {!units ? <Skeleton height={52} /> : (
              <ul className="knit-files">
                {units.slice(0, ROWS_SHOWN).map((u, k) => {
                  const errs = u.issues.filter((i) => i.level === "error"), warns = u.issues.filter((i) => i.level === "warning");
                  const status = errs.length ? <span className="knit-file-bad"><X size={12} aria-hidden /> Fix first</span>
                    : keptAsIs(u) ? <span className="knit-file-same">Kept</span>
                    : warns.length ? <span className="knit-file-warn"><AlertTriangle size={12} aria-hidden /> {warns.length} to look at</span>
                    : <span className="knit-file-ok"><Check size={12} aria-hidden /> Ready</span>;
                  const w = u.size.w * scale, h = u.size.h * scale;
                  return (
                    <li key={k}>
                      <div className="knit-file">
                        <SizeShape w={u.size.w} h={u.size.h} box={[24, 24]} />
                        <span><b>{u.label}</b><small>{TYPE[type]} {w} × {h} · {comesBackAs(u)}</small></span>
                        {status}
                      </div>
                      {[...errs, ...warns].length > 0 && !keptAsIs(u) && (
                        <ul className="knit-file-issues">
                          {[...errs, ...warns].slice(0, 3).map((i, n) => <li key={n} data-level={i.level}>{i.message}{i.stitchId && <> {editorHref ? <Link className="link" href={editorHref}>Fix it in the editor</Link> : <button type="button" className="link" onClick={() => show(i.stitchId!)}>Show me</button>}</>}</li>)}
                        </ul>
                      )}
                    </li>
                  );
                })}
                {units.length > ROWS_SHOWN && <li className="knit-files-more">And {units.length - ROWS_SHOWN} more, each checked the same way</li>}
              </ul>
            )}
          </section>

          <label className="knit-toggle"><span>Knit many from a table<small>One row per post, pasted from a spreadsheet</small></span><Switch label="Knit many from a table" checked={batch} onCheckedChange={setBatch} /></label>
          {batch && (
            <Field label="Table" hint={freeSlots.length ? `First line is the column names. This pattern's slots: ${freeSlots.join(", ")}. For an image slot, use a Yarn name or tag:product.` : "This pattern has no free slots yet. Name some stitches in the editor first."} htmlFor="kd-rows">
              <Textarea id="kd-rows" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={`${freeSlots.join("\t") || "headline"}\nSpring sale\nNew arrivals`} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }} />
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                <Button size="sm" onClick={() => setText(`${freeSlots.join("\t")}\n`)}>Start with this pattern's slots</Button>
                <span className="body-sm" style={{ color: "var(--ink-muted)" }}>{parsed.rows.length} {parsed.rows.length === 1 ? "row" : "rows"}</span>
              </div>
            </Field>
          )}
          <label className="knit-toggle"><span>Reuse identical knits<small>A file there already, exactly as it would be made, is kept, not drawn again</small></span><Switch label="Reuse identical knits" checked={reuse} onCheckedChange={setReuse} /></label>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "var(--space-4)" }} role="status" aria-live="polite">
          {job.progress && !finished && <StitchProgress total={job.progress.total} done={job.progress.done} label="knitted" />}
          {job.progress?.current && !finished && <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Now: {job.progress.current}</p>}
          {finished && (
            <p className="label" style={{ margin: 0 }}>
              {job.status === "cancelled" ? "Cancelled. What was already done is saved." : job.status === "failed" ? "Nothing could be knitted." : `${(job.result?.knitIds.length ?? 0)} ${(job.result?.knitIds.length ?? 0) === 1 ? "file" : "files"} ready${job.result?.failed ? `, ${job.result.failed} could not be made` : ""}.`}
            </p>
          )}
          {job.error && finished && job.status !== "cancelled" && <p className="field-error"><AlertTriangle size={14} aria-hidden /> {job.error}</p>}
          {job.progress?.units.some((u) => u.issues.length) && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {job.progress.units.filter((u) => u.issues.length).map((u, i) => (
                <li key={i} className="body-sm"><strong>{u.label}</strong>{u.status === "failed" ? " (not made)" : ""}<ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>{u.issues.map((x, k) => <li key={k} style={{ color: x.level === "error" ? "var(--danger)" : undefined }}>{x.message}</li>)}</ul></li>
              ))}
            </ul>
          )}
          {finished && job.result && job.result.knitIds.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {job.result.knitIds.slice(0, 6).map((id) => <img key={id} src={knitFileUrl({ id })} alt="" style={{ height: 120, borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface-sunken)" }} onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />)}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
