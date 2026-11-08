"use client";

// What is being knitted, in one place: the knit under way with a bar that moves as its
// frames are drawn, and the ones waiting their turn under it, each to cancel, or all at once.

import Link from "next/link";
import { api, type JobItem } from "@knitted/core/client";
import { Button, IconButton, icons } from "@knitted/ui";
import { useMarks } from "@/lib/agent";
import { ModelMark } from "./ModelMark";

const { X } = icons;

/** How far a knit is, from 0 to 1: the files done, and the frames of the one being drawn. */
export function knitShare(j: JobItem): number {
  const p = j.progress;
  if (!p || !p.total) return 0;
  const inFile = p.frames && p.frames.total ? p.frames.done / p.frames.total : 0;
  return Math.min(1, (p.done + inFile * 0.9) / p.total); // the last tenth of a file is its sound and checks
}

const nameOf = (j: JobItem) => j.input?.patternName ?? j.progress?.current ?? "A pattern";

/**
 * `href`: where the knits are, linked from its heading. `place`: the project a knit is in, named on its row,
 * where knits from every project are shown together. `compact`: the waiting ones as a count, not a list.
 */
export function KnitQueue({ jobs, href, place, compact }: { jobs: JobItem[]; href?: string; place?: (j: JobItem) => { label: string; href: string } | null; compact?: boolean }) {
  // A knit a model started, outlined with what it asked for.
  const marks = useMarks((w, c) => (c.tool === "knit_pattern" ? w.jobId : null));
  if (!jobs.length) return null;
  const where = (j: JobItem) => { const p = place?.(j); return p ? <><Link className="link" href={p.href}>{p.label}</Link><span aria-hidden style={{ color: "var(--ink-muted)" }}> · </span></> : null; };
  const running = jobs.filter((j) => j.status === "running");
  const waiting = jobs.filter((j) => j.status !== "running");
  const cancelAll = () => { for (const j of jobs) void api.knit.cancel(j.id); };
  return (
    <section className="panel knit-queue" aria-label="Knitting" style={{ padding: "var(--space-4)", marginBottom: "var(--space-4)", display: "grid", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span aria-hidden className="working" style={{ width: 8, height: 8, borderRadius: "50%" }} />
        <h3 className="label" style={{ margin: 0, flex: 1 }}>
          {running.length ? `Knitting ${running.length > 1 ? `${running.length} patterns` : nameOf(running[0])}` : "Waiting to start"}
          {waiting.length > 0 && <span style={{ color: "var(--ink-muted)", fontWeight: 400 }}>{` · ${waiting.length} waiting`}</span>}
        </h3>
        {href && <Link className="link body-sm" href={href}>See knits</Link>}
        {jobs.length > 1 && <Button size="sm" variant="ghost" onClick={cancelAll}>Cancel all</Button>}
      </div>
      {running.map((j) => {
        const p = j.progress;
        const pct = Math.round(knitShare(j) * 100);
        const of = p && p.total > 1 ? `File ${Math.min(p.total, p.done + 1)} of ${p.total}` : null;
        const frames = p?.frames && p.frames.total ? `frame ${p.frames.done} of ${p.frames.total}` : null;
        return (
          <div key={j.id} style={{ display: "grid", gap: 6, position: "relative" }}>
            <ModelMark mark={marks.get(j.id)} />
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span className="body-sm" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{where(j)}{p?.current ?? nameOf(j)}</span>
              <span className="body-sm" style={{ color: "var(--ink-muted)", whiteSpace: "nowrap" }}>{[of, p?.step, frames].filter(Boolean).join(" · ")}</span>
              <span className="label" style={{ minWidth: 40, textAlign: "right" }}>{pct}%</span>
              <IconButton label={`Cancel knitting ${nameOf(j)}`} onClick={() => api.knit.cancel(j.id)}><X size={14} aria-hidden /></IconButton>
            </div>
            <div className="knit-bar" role="progressbar" aria-label={`Knitting ${nameOf(j)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      {waiting.length > 0 && !compact && (
        <ul aria-label="Waiting to knit" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2, borderTop: running.length ? "1px solid var(--line)" : undefined, paddingTop: running.length ? "var(--space-2)" : 0 }}>
          {waiting.map((j, i) => (
            <li key={j.id} className="body-sm" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink-muted)" }}>
              <span style={{ minWidth: 18, textAlign: "right" }}>{i + 1}.</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink)" }}>{where(j)}{nameOf(j)}</span>
              <span>Waiting</span>
              <IconButton label={`Cancel knitting ${nameOf(j)}`} onClick={() => api.knit.cancel(j.id)}><X size={14} aria-hidden /></IconButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
