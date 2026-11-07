// A tiny in-process job queue over the jobs table.
//
// Render jobs are slow, so they are never an HTTP request that stays open: the
// caller gets a job id straight away and watches the row. One render at a time by
// default (each holds a browser), cancel works whether queued or running, and a
// job left "running" by a process that died is marked interrupted at startup.

import { readWebsite, setBriefSite } from "@knitted/core/node";
import { captureSite } from "./capture.mjs";
import { runKnit } from "./runner.mjs";

const g = globalThis;
const state = (g.__knittedJobs ??= { queue: [], running: 0, controllers: new Map(), concurrency: 1 });

export function startKnitJob(store, { projectId, patternId, params = {} }) {
  const p = store.getPattern(patternId);
  // Its name goes with it, so a knit waiting its turn can say what it is.
  const job = store.createJob("knit", projectId, { patternId, patternName: p.name, params });
  state.queue.push({ store, jobId: job.id, projectId, patternId, params });
  queueMicrotask(pump);
  return job;
}

function pump() {
  while (state.running < state.concurrency && state.queue.length) {
    const next = state.queue.shift();
    const ctl = new AbortController();
    state.controllers.set(next.jobId, ctl);
    state.running++;
    runKnit(next.store, { ...next, signal: ctl.signal })
      .catch(() => { /* runKnit has already recorded the failure on the job */ })
      .finally(() => { state.controllers.delete(next.jobId); state.running--; pump(); });
  }
}

export function cancelJob(store, jobId) {
  const queuedAt = state.queue.findIndex((q) => q.jobId === jobId);
  if (queuedAt >= 0) { state.queue.splice(queuedAt, 1); return store.updateJob(jobId, { status: "cancelled", error: "Cancelled." }); }
  state.controllers.get(jobId)?.abort();
  return store.getJob(jobId);
}

/**
 * Pictures of a business's public pages, at a desktop's width and a phone's, into the project's
 * reference: the site is read for its pages first, and each picture already there of a page is
 * replaced. For a model (capture_website); the studio's sync does this and more. Cancel works
 * like a knit's.
 */
export function startCaptureJob(store, { projectId, url, devices, maxPages = 40, reader = readWebsite, capture = captureSite, allow }) {
  store.getProject(projectId);
  const job = store.createJob("capture", projectId, { url, devices: devices ?? ["desktop", "mobile"], maxPages });
  const ctl = new AbortController();
  state.controllers.set(job.id, ctl);
  let current = "Reading the website", done = 0, total = 0;
  const report = () => { try { store.updateJob(job.id, { status: "running", progress: { done, total, current } }); } catch { /* the job was removed */ } };
  report();
  (async () => {
    try {
      const site = await reader(url, { maxPages, signal: ctl.signal });
      current = "Taking pictures";
      total = site.pages.length * (devices?.length ?? 2);
      report();
      const r = await capture(store, projectId, site.pages.map((p) => ({ url: p.url, title: p.title })), { devices, siteName: site.name, signal: ctl.signal, allow, onShot: (s) => { done = s.done; total = s.total; current = s.url ?? current; report(); } });
      if (ctl.signal.aborted) throw Object.assign(new Error("Stopped."), { name: "AbortError" });
      if (r.shots.length) setBriefSite(store, projectId, { url: site.url, pictures: r.shots.length });
      store.write(() => store.logRow(projectId, "model", "brief.synced", site.url, { pages: site.pages.length, pictures: r.shots.length, swatch: false, profile: false }));
      store.updateJob(job.id, {
        status: r.shots.length || !r.skipped.length ? "done" : "failed",
        progress: { done: total, total, current: "Done" },
        result: { yarnIds: r.shots.map((x) => x.yarnId), pictures: r.shots.length, replaced: r.shots.filter((x) => x.replaced).length, skipped: r.skipped.slice(0, 20), notes: site.notes },
        ...(r.shots.length || !r.skipped.length ? {} : { error: `None could be taken: ${r.skipped[0].why}.` }),
      });
    } catch (e) {
      const halted = ctl.signal.aborted;
      try { store.updateJob(job.id, { status: halted ? "cancelled" : "failed", error: halted ? "Cancelled." : e?.message ?? String(e) }); } catch { /* removed */ }
    } finally { state.controllers.delete(job.id); }
  })();
  return store.getJob(job.id);
}

export const setConcurrency = (n) => { state.concurrency = Math.max(1, Math.min(4, n)); pump(); };

/**
 * Wait for a job to finish and describe what it made. For callers that want files
 * rather than a job id (a model, the CLI); the studio itself watches the row.
 * `files(knitId)` maps a knit record to a path.
 */
export async function waitForJob(store, jobId, { files = (id) => id, timeoutMs = 10 * 60_000 } = {}) {
  const terminal = ["done", "failed", "cancelled", "interrupted"];
  const deadline = Date.now() + timeoutMs;
  let j = store.getJob(jobId);
  while (!terminal.includes(j.status)) {
    if (Date.now() > deadline) return { jobId, status: j.status, note: "Still running. Check it again with get_job." };
    await new Promise((r) => setTimeout(r, 250));
    j = store.getJob(jobId);
  }
  return {
    jobId, status: j.status, files: (j.result?.knitIds ?? []).map(files),
    issues: (j.progress?.units ?? []).flatMap((u) => u.issues.map((i) => ({ unit: u.label, level: i.level, message: i.message }))), error: j.error,
  };
}
