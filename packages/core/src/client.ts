// A typed fetch client for the studio's own API, safe in the browser.
//
// The editor, the dashboard and the settings page all go through this, so a
// route's shape lives in one place and a change to it is a type error here.

import type { Actor, AgentState, ColorRole, Part, Pattern, Project, Refusal, Size, Swatch, Yarn } from "./types.ts";
import type { SiteProposal } from "./site.ts";
import type { KnitIssue, KnitRecord } from "./knits.ts";
import type { Command } from "./commands.ts";

export interface ProjectSummary extends Project { counts: { patterns: number; yarn: number; knits: number }; cover: { id: string; hash: string } | null; }
export interface ActivityItem { id: string; projectId: string | null; actor: string; action: string; subject: string | null; detail: unknown; createdAt: string; }
export interface RevisionItem { id: string; patternId: string; author: Actor; label: string | null; createdAt: string; }
export interface ApplyResponse { pattern: Pattern; inverse: Command | null; refusals: Refusal[]; changed: boolean; }

export class ApiError extends Error {
  readonly status: number;
  readonly kind: string;
  readonly detail?: unknown;
  constructor(status: number, kind: string, message: string, detail?: unknown) { super(message); this.status = status; this.kind = kind; this.detail = detail; }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body !== undefined ? { "content-type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.kind ?? "error", data?.error?.message ?? "Something went wrong. Try again.", data?.error);
  return data as T;
}

export const api = {
  projects: {
    list: (q: { archived?: boolean; deleted?: boolean } = {}) =>
      call<ProjectSummary[]>("GET", `/api/projects?${new URLSearchParams({ ...(q.archived ? { archived: "1" } : {}), ...(q.deleted ? { deleted: "1" } : {}) })}`),
    get: (id: string) => call<Project>("GET", `/api/projects/${id}`),
    create: (b: { name: string; description?: string; starter?: "blank" | "social" }) => call<Project>("POST", "/api/projects", b),
    update: (id: string, b: { name?: string; description?: string; swatchId?: string | null; coverYarnId?: string | null }) => call<Project>("PATCH", `/api/projects/${id}`, b),
    action: (id: string, action: "duplicate" | "archive" | "restore" | "undelete", b: { name?: string } = {}) => call<Project>("POST", `/api/projects/${id}/actions`, { action, ...b }),
    remove: (id: string) => call<{ ok: true }>("DELETE", `/api/projects/${id}`),
    activity: (id: string) => call<ActivityItem[]>("GET", `/api/projects/${id}/activity`),
  },
  patterns: {
    list: (projectId: string) => call<Pattern[]>("GET", `/api/projects/${projectId}/patterns`),
    create: (projectId: string, b: { name?: string; size?: Size }) => call<Pattern>("POST", `/api/projects/${projectId}/patterns`, b),
    get: (id: string) => call<Pattern>("GET", `/api/patterns/${id}`),
    duplicate: (id: string) => call<Pattern>("POST", `/api/patterns/${id}/actions`, { action: "duplicate" }),
    remove: (id: string) => call<{ ok: true }>("DELETE", `/api/patterns/${id}`),
    apply: (id: string, command: Command, o: { actor?: "human" | "fill"; expectVersion?: number; label?: string; coalesce?: boolean } = {}) =>
      call<ApplyResponse>("POST", `/api/patterns/${id}/commands`, { command, ...o }),
    revisions: (id: string) => call<RevisionItem[]>("GET", `/api/patterns/${id}/revisions`),
    restore: (id: string, revisionId: string) => call<Pattern>("POST", `/api/patterns/${id}/revisions`, { revisionId }),
  },
  yarn: {
    list: (projectId: string, q: { kind?: string; q?: string; tag?: string } = {}) =>
      call<Yarn[]>("GET", `/api/projects/${projectId}/yarn?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`),
    get: (id: string) => call<{ yarn: Yarn; usage: { patternId: string; patternName: string; projectId: string }[] }>("GET", `/api/yarn/${id}`),
    update: (id: string, b: { name?: string; tags?: string[] }) => call<Yarn>("PATCH", `/api/yarn/${id}`, b),
    remove: (id: string) => call<{ ok: true }>("DELETE", `/api/yarn/${id}`),
    undelete: (id: string) => call<Yarn>("POST", `/api/yarn/${id}`, { action: "undelete" }),
    copy: (projectId: string, b: { name: string; text: string }) => call<{ yarn: Yarn; existing: boolean }>("POST", `/api/projects/${projectId}/yarn/copy`, b),
    fromUrl: (projectId: string, url: string) => call<{ yarn: Yarn; existing: boolean }>("POST", `/api/projects/${projectId}/yarn/url`, { url }),
  },
  swatches: {
    list: (projectId: string) => call<Swatch[]>("GET", `/api/projects/${projectId}/swatches`),
    create: (projectId: string, b: { template?: string; data?: unknown; activate?: boolean }) => call<Swatch>("POST", `/api/projects/${projectId}/swatches`, b),
    update: (id: string, patch: unknown) => call<Swatch>("PATCH", `/api/swatches/${id}`, patch),
    remove: (id: string) => call<{ ok: true }>("DELETE", `/api/swatches/${id}`),
    activate: (id: string) => call<Swatch>("POST", `/api/swatches/${id}`, { action: "activate" }),
    duplicate: (id: string) => call<Swatch>("POST", `/api/swatches/${id}`, { action: "duplicate" }),
    import: (projectId: string, file: unknown) => call<Swatch>("POST", `/api/projects/${projectId}/swatches/import`, file),
    /** Read a website into a proposal; nothing is saved. `matched`: the fonts this project can draw. */
    fromUrl: (projectId: string, url: string) => call<SiteProposal & { matched: Record<"display" | "body" | "mono", { family: string; yarnId?: string; from: "bundled" | "yarn" } | null> }>("POST", `/api/projects/${projectId}/swatches/from-url`, { url }),
    /** Save a proposal, as the person left it, as a new swatch (not made the project's). */
    fromSite: (projectId: string, b: { name: string; colors: { role: ColorRole; name: string; hex: string }[]; fonts?: { display?: string; body?: string; mono?: string }; logo?: { url: string; use: "full" | "mark" } }) => call<{ swatch: Swatch; notes: string[] }>("POST", `/api/projects/${projectId}/swatches/from-site`, b),
    colorsFromYarn: (yarnId: string) => call<string[]>("GET", `/api/yarn/${yarnId}/colors`),
  },
  parts: {
    list: (projectId: string) => call<Part[]>("GET", `/api/projects/${projectId}/parts`),
    get: (id: string) => call<{ part: Part; usage: { patternId: string; patternName: string; projectId: string }[] }>("GET", `/api/parts/${id}`),
    create: (projectId: string, b: unknown) => call<Part>("POST", `/api/projects/${projectId}/parts`, b),
    update: (id: string, b: unknown) => call<Part>("PATCH", `/api/parts/${id}`, b),
    remove: (id: string) => call<{ usedIn: number }>("DELETE", `/api/parts/${id}`),
    action: (id: string, action: "duplicate" | "to-library" | "to-project" | "export", projectId?: string) => call<Part>("POST", `/api/parts/${id}`, { action, projectId }),
    import: (projectId: string, file: unknown, scope: "project" | "library" = "project") => call<Part>("POST", `/api/projects/${projectId}/parts`, { name: "import", file, scope }),
  },
  voice: {
    config: () => call<VoiceConfig>("GET", "/api/voice/config"),
    save: (b: Partial<Omit<VoiceConfig, "key">> & { apiKey?: string; clearKey?: boolean }) => call<VoiceConfig>("PUT", "/api/voice/config", b),
    voices: () => call<{ provider: string; label: string; available: boolean; voices: { id: string; label: string }[] }>("GET", "/api/voice/voices"),
    /** Speak one sentence and return the audio. Errors carry the provider's one-line fix. */
    async test(text: string, voice?: string): Promise<{ url: string; durationMs: number }> {
      const res = await fetch("/api/voice/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice }) });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new ApiError(res.status, j?.error?.kind ?? "error", j?.error?.message ?? "That voice did not answer."); }
      return { url: URL.createObjectURL(await res.blob()), durationMs: Number(res.headers.get("x-duration-ms") ?? 0) };
    },
    generate: (patternId: string, b: { lines: string[]; voice?: string; speed?: number; startMs?: number; gapMs?: number; captions?: boolean }) => call<JobItem>("POST", `/api/patterns/${patternId}/voiceover`, b),
  },
  knit: {
    start: (patternId: string, params: KnitParams) => call<JobItem>("POST", `/api/patterns/${patternId}/knit`, { params }),
    preview: (patternId: string, params: KnitParams) => call<{ units: { label: string; size: Size; issues: KnitIssue[] }[] }>("POST", `/api/patterns/${patternId}/knit`, { params, dryRun: true }),
    job: (id: string) => call<JobItem>("GET", `/api/jobs/${id}`),
    cancel: (id: string) => call<JobItem>("DELETE", `/api/jobs/${id}`),
    list: (projectId: string, q: { pattern?: string; batch?: string } = {}) => call<KnitRecord[]>("GET", `/api/projects/${projectId}/knits?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`),
    remove: (id: string) => call<{ ok: true }>("DELETE", `/api/knits/${id}`),
  },
  agent: {
    config: () => call<ModelConfig>("GET", "/api/agent/model"),
    save: (b: Partial<Pick<ModelConfig, "model" | "maxTurns" | "maxKnits">> & { apiKey?: string; clearKey?: boolean }) => call<ModelConfig>("PUT", "/api/agent/model", b),
    test: () => call<{ ok: true }>("POST", "/api/agent/model/test", {}),
    /** The path of the MCP address for Claude Code and other MCP clients, key included. POST makes a new one. */
    mcp: () => call<{ path: string }>("GET", "/api/agent/mcp"),
    newMcpAddress: () => call<{ path: string }>("POST", "/api/agent/mcp", {}),
    start: (b: { projectId: string; patternId?: string; prompt: string; mode?: "edit" | "suggest" }) => call<AgentJob>("POST", "/api/agent", b),
    job: (id: string) => call<AgentJob>("GET", `/api/jobs/${id}`),
    cancel: (id: string) => call<AgentJob>("DELETE", `/api/jobs/${id}`),
    /** What models have been doing lately; subscribeAgent keeps up with it. */
    activity: () => call<AgentState>("GET", "/api/agent/activity"),
    /** While paused, a model's edits are refused and it is told to wait for the person. */
    pause: (paused: boolean) => call<AgentState>("POST", "/api/agent/activity", { paused }),
  },
  fonts: () => call<{ family: string; category: string; file: string; style: string; weight: [number, number]; license: string }[]>("GET", "/api/fonts"),
  storage: () => call<{ root: string; bytes: number; projects: number }>("GET", "/api/storage"),
  backups: {
    list: () => call<BackupItem[]>("GET", "/api/storage/backups"),
    create: () => call<BackupItem>("POST", "/api/storage/backups", {}),
  },
};

// ONE stream per page, shared by everyone who asks.
//
// Browsers allow about six connections per host, and an SSE stream holds one
// open for as long as the page lives. Giving every component its own meant a
// page with six live lists used every connection, so the seventh request (a save,
// a navigation) waited forever behind them and looked like a hang. Listeners
// share a single EventSource, which closes when the last one leaves.
const listeners = new Set<(rev: number) => void>();
const watchers = new Set<(s: AgentState) => void>();
let source: EventSource | null = null;
let lastAgent: AgentState | null = null;

function open() {
  if (source) return;
  source = new EventSource("/api/events");
  source.addEventListener("changed", (e) => {
    const rev = Number(JSON.parse((e as MessageEvent).data).rev);
    for (const l of [...listeners]) l(rev);
  });
  source.addEventListener("agent", (e) => {
    lastAgent = JSON.parse((e as MessageEvent).data) as AgentState;
    for (const w of [...watchers]) w(lastAgent);
  });
}
function closeIfDone() {
  if (listeners.size === 0 && watchers.size === 0 && source) { source.close(); source = null; lastAgent = null; }
}

/** Subscribe to "something changed in the library". Returns an unsubscribe. */
export function subscribeChanges(onChange: (rev: number) => void): () => void {
  if (typeof EventSource === "undefined") return () => {};
  listeners.add(onChange);
  open();
  return () => { listeners.delete(onChange); closeIfDone(); };
}

/** Subscribe to what models are doing, on the same stream: called with the whole state each time it moves. */
export function subscribeAgent(onState: (s: AgentState) => void): () => void {
  if (typeof EventSource === "undefined") return () => {};
  watchers.add(onState);
  open();
  if (lastAgent) onState(lastAgent);
  return () => { watchers.delete(onState); closeIfDone(); };
}

export const yarnFileUrl = (y: Pick<Yarn, "id" | "hash">) => `/api/yarn/${y.id}/file?v=${y.hash.slice(0, 10)}`;
export const yarnThumbUrl = (y: Pick<Yarn, "id" | "hash">) => `/api/yarn/${y.id}/thumb?v=${y.hash.slice(0, 10)}`;
/** A bigger preview, 960 pixels on its longest side, for one picture shown large: a project's card. */
export const yarnPictureUrl = (y: Pick<Yarn, "id" | "hash">) => `/api/yarn/${y.id}/thumb?size=large&v=${y.hash.slice(0, 10)}`;

export interface UploadHandle { promise: Promise<{ yarn: Yarn; existing: boolean }>; cancel: () => void; }

/**
 * Upload one file with real progress. `fetch` cannot report upload progress, so
 * this uses XMLHttpRequest. The file is the raw request body (not multipart) so
 * the server can stream it to disk, and cancelling aborts the request, which the
 * server turns into a cleaned-up temp file.
 */
export function uploadYarn(projectId: string, file: File, onProgress: (fraction: number) => void, opts: { replaceId?: string } = {}): UploadHandle {
  const xhr = new XMLHttpRequest();
  const url = opts.replaceId ? `/api/yarn/${opts.replaceId}/file?filename=${encodeURIComponent(file.name)}` : `/api/projects/${projectId}/yarn?filename=${encodeURIComponent(file.name)}`;
  const promise = new Promise<{ yarn: Yarn; existing: boolean }>((resolve, reject) => {
    xhr.open(opts.replaceId ? "PUT" : "POST", url);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: unknown = null;
      try { data = JSON.parse(xhr.responseText); } catch {}
      const d = data as { error?: { kind?: string; message?: string } } | null;
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as { yarn: Yarn; existing: boolean });
      else reject(new ApiError(xhr.status, d?.error?.kind ?? "error", d?.error?.message ?? "That upload failed. Try again."));
    };
    xhr.onerror = () => reject(new ApiError(0, "network", "The upload could not reach the app. Is it still running?"));
    xhr.onabort = () => reject(new ApiError(0, "cancelled", "Upload cancelled."));
    xhr.send(file);
  });
  return { promise, cancel: () => xhr.abort() };
}

export interface KnitParams { sizes?: Size[]; format?: "png" | "jpeg" | "webp" | "mp4"; scale?: 1 | 2; rows?: Record<string, string>[]; reuse?: boolean; }
export interface JobItem {
  id: string; kind: string; status: "queued" | "running" | "done" | "failed" | "cancelled" | "interrupted"; projectId: string | null; error: string | null;
  progress: { total: number; done: number; current: string | null; units: { label: string; status: string; issues: KnitIssue[]; knitId?: string }[] } | null;
  result: { knitIds: string[]; failed: number } | null; createdAt: string; finishedAt: string | null;
}
export const knitFileUrl = (k: { id: string }, download = false) => `/api/knits/${k.id}/file${download ? "?download=1" : ""}`;
export type { KnitRecord, KnitIssue };

export interface VoiceConfig {
  provider: "system" | "openai" | "piper"; voice: string; speed: number; baseUrl: string; model: string;
  key: { present: boolean; source: "environment" | "keychain" | "none"; backend: string | null; canStore: boolean };
}

export interface ModelConfig {
  model: string; maxTurns: number; maxKnits: number; models: { id: string; label: string }[];
  key: { present: boolean; source: "environment" | "keychain" | "none"; backend: string | null; canStore: boolean };
}
export type AgentEvent = { type: "text"; text: string } | { type: "tool_call"; name: string; input: unknown } | { type: "tool_result"; name: string; summary: string } | { type: "refusal"; slot: string; why: string } | { type: "stopped"; why: string };
export interface AgentJob {
  id: string; status: JobItem["status"]; error: string | null;
  progress: { current: string | null; events: AgentEvent[] } | null;
  result: { text: string; turns: number; toolCalls: number; refusals: { tool: string; slot?: string; why: string }[]; stopped: string | null; usage: unknown; patternId: string | null; originalPatternId: string | null; suggestion: string | null; baselineRevisionId: string | null; changedCount: number } | null;
}

export interface BackupItem { name: string; bytes: number; createdAt: string; kind: "daily" | "manual" | "pre-migration"; }
