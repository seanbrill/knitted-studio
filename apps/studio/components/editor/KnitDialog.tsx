"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, knitFileUrl, type JobItem, type KnitParams } from "@knitted/core/client";
import { SIZES, type Pattern, type KnitIssue } from "@knitted/core";
import { Button, Dialog, Field, SegmentedControl, Skeleton, StitchProgress, Switch, Textarea, icons, useToast } from "@knitted/ui";
import { RendererCard } from "../RendererCard";

const { AlertTriangle, Check } = icons;

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

export function KnitDialog({ open, onOpenChange, pattern, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; pattern: Pattern; projectId: string }) {
  const toast = useToast();
  const motion = pattern.durationMs > 0;
  const [format, setFormat] = useState<"png" | "jpeg" | "webp" | "mp4">(motion ? "mp4" : "png");
  const [scale, setScale] = useState<1 | 2>(1);
  const [sizes, setSizes] = useState<string[]>([pattern.size.name]);
  const [reuse, setReuse] = useState(true);
  const [batch, setBatch] = useState(false);
  const [text, setText] = useState("");
  const [units, setUnits] = useState<{ label: string; issues: KnitIssue[] }[] | null>(null);
  const [job, setJob] = useState<JobItem | null>(null);
  const [busy, setBusy] = useState(false);
  // The first knit on a new computer: the browser it draws with is downloaded here, first.
  const [canDraw, setCanDraw] = useState(true);
  const watch = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const freeSlots = pattern.stitches.filter((s) => !s.locked && s.slot).map((s) => s.slot!);
  const parsed = useMemo(() => parseRows(text), [text]);
  const chosenSizes = useMemo(() => (sizes.length ? SIZES.filter((s) => sizes.includes(s.name)).concat(sizes.includes(pattern.size.name) && !SIZES.some((s) => s.name === pattern.size.name) ? [pattern.size] : []) : [pattern.size]), [sizes, pattern.size]);
  const params: KnitParams = useMemo(() => ({ sizes: chosenSizes, format: motion ? "mp4" : format, scale, reuse, rows: batch && parsed.rows.length ? parsed.rows : undefined }), [chosenSizes, format, scale, reuse, batch, parsed, motion]);
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
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };

  const errors = units?.flatMap((u) => u.issues.filter((i) => i.level === "error")) ?? [];
  const warnings = units?.flatMap((u) => u.issues.filter((i) => i.level === "warning")) ?? [];
  const finished = !!job && ["done", "failed", "cancelled", "interrupted"].includes(job.status);

  return (
    <Dialog open={open} onOpenChange={close} wide title={job ? (finished ? "Knit finished" : "Knitting...") : "Knit"} description={job ? undefined : `Make real files from ${pattern.name}.`}
      actions={job ? (
        finished ? <><Button variant="ghost" onClick={() => close(false)}>Close</Button><Link href={`/projects/${projectId}/knits`} className="btn btn-primary">See your knits</Link></>
          : <Button variant="danger" onClick={() => api.knit.cancel(job.id)}>Cancel</Button>
      ) : (<><Button variant="ghost" onClick={() => close(false)}>Cancel</Button><Button variant="primary" disabled={busy || !canDraw || errors.length > 0 || (batch && parsed.rows.length === 0)} onClick={go}>Knit {total} {total === 1 ? "file" : "files"}</Button></>)}>
      {!job ? (
        <div style={{ display: "grid", gap: "var(--space-5)" }}>
          <RendererCard missingOnly onReady={setCanDraw} />
          <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
            <Field label="Format">
              <SegmentedControl label="Format" value={motion ? "mp4" : format} onChange={setFormat} options={motion ? [{ value: "mp4", label: "MP4 video" }] : [{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }, { value: "webp", label: "WebP" }]} />
            </Field>
            <Field label="Quality"><SegmentedControl<"1" | "2"> label="Scale" value={String(scale) as "1" | "2"} onChange={(v) => setScale(Number(v) as 1 | 2)} options={[{ value: "1", label: "1x" }, { value: "2", label: "2x sharper" }]} /></Field>
          </div>
          <Field label="Sizes" hint="Knit the same pattern at several sizes in one go.">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="Sizes">
              {SIZES.map((s) => <button key={s.name} type="button" className="chip chip-button" aria-pressed={sizes.includes(s.name)} onClick={() => setSizes((cur) => (cur.includes(s.name) ? cur.filter((x) => x !== s.name) : [...cur, s.name]))}>{s.name} <span className="code" style={{ color: "var(--ink-muted)" }}>{s.w}x{s.h}</span></button>)}
            </div>
          </Field>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}><span className="body-sm">Knit many from a table<br /><span style={{ color: "var(--ink-muted)" }}>One row per post. Paste from a spreadsheet.</span></span><Switch label="Knit many from a table" checked={batch} onCheckedChange={setBatch} /></label>
          {batch && (
            <Field label="Table" hint={freeSlots.length ? `First line is the column names. This pattern's slots: ${freeSlots.join(", ")}. For an image slot, use a Yarn name or tag:product.` : "This pattern has no free slots yet. Name some stitches in the editor first."} htmlFor="kd-rows">
              <Textarea id="kd-rows" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={`${freeSlots.join("\t") || "headline"}\nSpring sale\nNew arrivals`} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }} />
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                <Button size="sm" onClick={() => setText(`${freeSlots.join("\t")}\n`)}>Start with this pattern's slots</Button>
                <span className="body-sm" style={{ color: "var(--ink-muted)" }}>{parsed.rows.length} {parsed.rows.length === 1 ? "row" : "rows"}</span>
              </div>
            </Field>
          )}
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}><span className="body-sm">Reuse identical knits<br /><span style={{ color: "var(--ink-muted)" }}>If nothing changed, skip redrawing it.</span></span><Switch label="Reuse identical knits" checked={reuse} onCheckedChange={setReuse} /></label>

          <section aria-label="Checks" aria-live="polite">
            <h3 className="eyebrow" style={{ marginBottom: 6 }}>Checks</h3>
            {!units ? <Skeleton height={20} /> : errors.length + warnings.length === 0 ? <p className="body-sm" style={{ margin: 0, color: "var(--success)", display: "flex", gap: 6, alignItems: "center" }}><Check size={14} aria-hidden /> Ready to knit. Nothing to fix.</p> : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                {[...errors, ...warnings].slice(0, 8).map((i, k) => <li key={k} className="body-sm" style={{ display: "flex", gap: 6, color: i.level === "error" ? "var(--danger)" : "var(--ink)" }}><AlertTriangle size={14} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} /><span><strong>{i.level === "error" ? "Fix this first: " : "Heads up: "}</strong>{i.message}</span></li>)}
              </ul>
            )}
          </section>
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
