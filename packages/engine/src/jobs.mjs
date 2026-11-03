// A tiny in-process job queue over the jobs table.
//
// Render jobs are slow, so they are never an HTTP request that stays open: the
// caller gets a job id straight away and watches the row. One render at a time by
// default (each holds a browser), cancel works whether queued or running, and a
// job left "running" by a process that died is marked interrupted at startup.

import { runKnit } from "./runner.mjs";

const g = globalThis;
const state = (g.__knittedJobs ??= { queue: [], running: 0, controllers: new Map(), concurrency: 1 });

export function startKnitJob(store, { projectId, patternId, params = {} }) {
  store.getPattern(patternId);
  const job = store.createJob("knit", projectId, { patternId, params });
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
