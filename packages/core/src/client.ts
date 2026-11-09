// A typed fetch client for the studio's own API, safe in the browser.
//
// The editor, the dashboard and the settings page all go through this, so a
// route's shape lives in one place and a change to it is a type error here.

import type { Actor, AgentState, Brief, ColorRole, CommentThread, CropBox, Part, Pattern, Project, Refusal, Shelf, Size, Swatch, Yarn } from "./types.ts";
import type { FolderSection } from "./folders-pure.ts";
import type { SiteProposal } from "./site.ts";
import type { KnitIssue, KnitRecord } from "./knits.ts";
import type { Command } from "./commands.ts";
import type { SpendLimits, UsageSummary } from "./usage.ts";
import type { PostChange, SocialAccount, SocialPost } from "./social.ts";
import type { Platform } from "./social-pure.ts";
import type { StockItem, StockKind, StockProvider, StockSource } from "./stock-pure.ts";
import type { GenAspect, GenKind, GenProvider, GenQuality, GenSource } from "./gen-pure.ts";
import type { Insights } from "./social-insights.ts";
import type { Design, DesignLint, DesignOp } from "./design-pure.ts";

export interface ProjectSummary extends Project { counts: { patterns: number; yarn: number; knits: number; newKnits: number }; cover: { id: string; hash: string } | null; }
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
    get: (id: string) => call<Project & { newKnits: number }>("GET", `/api/projects/${id}`),
    create: (b: { name: string; description?: string; starter?: "blank" | "social" }) => call<Project>("POST", "/api/projects", b),
    update: (id: string, b: { name?: string; description?: string; swatchId?: string | null; coverYarnId?: string | null }) => call<Project>("PATCH", `/api/projects/${id}`, b),
    action: (id: string, action: "duplicate" | "archive" | "restore" | "undelete", b: { name?: string } = {}) => call<Project>("POST", `/api/projects/${id}/actions`, { action, ...b }),
    remove: (id: string) => call<{ ok: true }>("DELETE", `/api/projects/${id}`),
    activity: (id: string) => call<ActivityItem[]>("GET", `/api/projects/${id}/activity`),
  },
  /** Each section's folders. Moving a folder is renaming it to its whole new path; deleting one deletes nothing in it. */
  folders: {
    list: (projectId: string, section: FolderSection) => call<{ folders: string[] }>("GET", `/api/projects/${projectId}/folders?section=${section}`).then((r) => r.folders),
    create: (projectId: string, section: FolderSection, path: string) => call<{ path: string }>("POST", `/api/projects/${projectId}/folders`, { action: "create", section, path }),
    rename: (projectId: string, section: FolderSection, from: string, to: string) => call<{ path: string }>("POST", `/api/projects/${projectId}/folders`, { action: "rename", section, from, to }),
    remove: (projectId: string, section: FolderSection, path: string) => call<{ folder: string; movedTo: string; moved: number }>("POST", `/api/projects/${projectId}/folders`, { action: "delete", section, path }),
    move: (projectId: string, section: FolderSection, ids: string[], folder: string) => call<{ folder: string; moved: number }>("POST", `/api/projects/${projectId}/folders`, { action: "move", section, ids, folder }),
  },
  patterns: {
    list: (projectId: string) => call<Pattern[]>("GET", `/api/projects/${projectId}/patterns`),
    create: (projectId: string, b: { name?: string; size?: Size; folder?: string }) => call<Pattern>("POST", `/api/projects/${projectId}/patterns`, b),
    get: (id: string) => call<Pattern>("GET", `/api/patterns/${id}`),
    duplicate: (id: string) => call<Pattern>("POST", `/api/patterns/${id}/actions`, { action: "duplicate" }),
    remove: (id: string) => call<{ ok: true }>("DELETE", `/api/patterns/${id}`),
    apply: (id: string, command: Command, o: { actor?: "human" | "fill"; expectVersion?: number; label?: string; coalesce?: boolean } = {}) =>
      call<ApplyResponse>("POST", `/api/patterns/${id}/commands`, { command, ...o }),
    revisions: (id: string) => call<RevisionItem[]>("GET", `/api/patterns/${id}/revisions`),
    restore: (id: string, revisionId: string) => call<Pattern>("POST", `/api/patterns/${id}/revisions`, { revisionId }),
  },
  yarn: {
    /** `shelf`: Yarn, unless it says the reference (the Brief's files). `library: false`: without the Library's files. */
    list: (projectId: string, q: { kind?: string; q?: string; tag?: string; shelf?: Shelf; library?: boolean } = {}) =>
      call<Yarn[]>("GET", `/api/projects/${projectId}/yarn?${new URLSearchParams(Object.entries({ ...q, library: q.library === false ? "0" : undefined }).filter(([, v]) => v) as [string, string][])}`),
    get: (id: string) => call<{ yarn: Yarn; usage: { patternId: string; patternName: string; projectId: string }[] }>("GET", `/api/yarn/${id}`),
    update: (id: string, b: { name?: string; tags?: string[] }) => call<Yarn>("PATCH", `/api/yarn/${id}`, b),
    remove: (id: string) => call<{ ok: true }>("DELETE", `/api/yarn/${id}`),
    undelete: (id: string) => call<Yarn>("POST", `/api/yarn/${id}`, { action: "undelete" }),
    /** Into the Library, for every project (`to` LIBRARY_ID), or out of it into the project `to`. */
    share: (id: string, to: string) => call<Yarn>("POST", `/api/yarn/${id}`, { action: "share", to }),
    copy: (projectId: string, b: { name: string; text: string; folder?: string; shelf?: Shelf }) => call<{ yarn: Yarn; existing: boolean }>("POST", `/api/projects/${projectId}/yarn/copy`, b),
    fromUrl: (projectId: string, url: string, folder?: string, shelf?: Shelf) => call<{ yarn: Yarn; existing: boolean }>("POST", `/api/projects/${projectId}/yarn/url`, { url, folder, shelf }),
    /** A part of a picture or a PDF's page, as a new picture: in Yarn unless `shelf` says the reference. */
    crop: (id: string, b: { box: CropBox; page?: number; name?: string; shelf?: Shelf; folder?: string }) => call<{ yarn: Yarn; existing: boolean }>("POST", `/api/yarn/${id}/crop`, b),
    /** A PDF's text, a page at a time, the first page first. */
    text: (id: string) => call<{ pages: string[] }>("GET", `/api/yarn/${id}/text`),
  },
  /** What a model knows about the business: its profile, and the notes for whoever builds it. */
  brief: {
    get: (projectId: string) => call<Brief>("GET", `/api/projects/${projectId}/brief`),
    save: (projectId: string, b: { profile?: string; notes?: string }) => call<Brief>("PUT", `/api/projects/${projectId}/brief`, b),
    /**
     * Sync with the website: read it, read a swatch from it, have the person's model write the
     * profile (from the site, the reference and a write-up), and picture its pages for the reference.
     */
    sync: (projectId: string, b: SyncOptions) => call<SyncJob>("POST", `/api/projects/${projectId}/brief/sync`, b),
    undo: (projectId: string) => call<Brief>("POST", `/api/projects/${projectId}/brief/undo`, {}),
    job: (id: string) => call<SyncJob>("GET", `/api/jobs/${id}`),
    cancel: (id: string) => call<SyncJob>("DELETE", `/api/jobs/${id}`),
  },
  swatches: {
    list: (projectId: string) => call<Swatch[]>("GET", `/api/projects/${projectId}/swatches`),
    create: (projectId: string, b: { template?: string; data?: unknown; activate?: boolean; folder?: string }) => call<Swatch>("POST", `/api/projects/${projectId}/swatches`, b),
    update: (id: string, patch: unknown) => call<Swatch>("PATCH", `/api/swatches/${id}`, patch),
    remove: (id: string) => call<{ ok: true }>("DELETE", `/api/swatches/${id}`),
    activate: (id: string) => call<Swatch>("POST", `/api/swatches/${id}`, { action: "activate" }),
    duplicate: (id: string) => call<Swatch>("POST", `/api/swatches/${id}`, { action: "duplicate" }),
    import: (projectId: string, file: unknown, folder?: string) => call<Swatch>("POST", `/api/projects/${projectId}/swatches/import${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`, file),
    /** Read a website into a proposal; nothing is saved. `matched`: the fonts this project can draw. */
    fromUrl: (projectId: string, url: string) => call<SiteProposal & { matched: Record<"display" | "body" | "mono", { family: string; yarnId?: string; from: "bundled" | "yarn" } | null> }>("POST", `/api/projects/${projectId}/swatches/from-url`, { url }),
    /** Save a proposal, as the person left it, as a new swatch (not made the project's). */
    fromSite: (projectId: string, b: { name: string; colors: { role: ColorRole; name: string; hex: string }[]; fonts?: { display?: string; body?: string; mono?: string }; logo?: { url: string; use: "full" | "mark" }; folder?: string }) => call<{ swatch: Swatch; notes: string[] }>("POST", `/api/projects/${projectId}/swatches/from-site`, b),
    colorsFromYarn: (yarnId: string) => call<string[]>("GET", `/api/yarn/${yarnId}/colors`),
  },
  parts: {
    list: (projectId: string) => call<Part[]>("GET", `/api/projects/${projectId}/parts`),
    get: (id: string) => call<{ part: Part; usage: { patternId: string; patternName: string; projectId: string }[] }>("GET", `/api/parts/${id}`),
    create: (projectId: string, b: unknown) => call<Part>("POST", `/api/projects/${projectId}/parts`, b),
    update: (id: string, b: unknown) => call<Part>("PATCH", `/api/parts/${id}`, b),
    remove: (id: string) => call<{ usedIn: number }>("DELETE", `/api/parts/${id}`),
    /** `folder`, for duplicate: where the copy goes. Left out, it goes next to the original. */
    action: (id: string, action: "duplicate" | "to-library" | "to-project" | "export", projectId?: string, folder?: string) => call<Part>("POST", `/api/parts/${id}`, { action, projectId, folder }),
    import: (projectId: string, file: unknown, scope: "project" | "library" = "project", folder?: string) => call<Part>("POST", `/api/projects/${projectId}/parts`, { name: "import", file, scope, folder }),
    /** The pattern a Part is edited through, to open in the editor. Every change there is the Part's. */
    edit: (id: string, projectId: string) => call<Pattern>("POST", `/api/parts/${id}`, { action: "edit", projectId }),
  },
  comments: {
    list: (q: { knit?: string; design?: string; frame?: string; project?: string; open?: boolean }) => call<CommentThread[]>("GET", `/api/comments?${new URLSearchParams(Object.entries({ ...q, open: q.open ? "1" : undefined }).filter(([, v]) => v) as [string, string][])}`),
    counts: (projectId: string) => call<Record<string, number>>("GET", `/api/comments?project=${encodeURIComponent(projectId)}&counts=1`),
    add: (b: { knitId?: string; designId?: string; frameId?: string; x?: number; y?: number; timeMs?: number; text: string }) => call<CommentThread>("POST", "/api/comments", b),
    reply: (id: string, b: { text: string; resolve?: boolean }) => call<CommentThread>("POST", `/api/comments/${id}/replies`, b),
    update: (id: string, b: { text?: string; resolved?: boolean }) => call<CommentThread>("PATCH", `/api/comments/${id}`, b),
    remove: (id: string) => call<{ ok: true }>("DELETE", `/api/comments/${id}`),
  },
  designs: {
    list: (projectId: string) => call<Design[]>("GET", `/api/projects/${projectId}/designs`),
    create: (projectId: string, b: { name: string; start?: "brand" | "blank" }) => call<Design>("POST", `/api/projects/${projectId}/designs`, b),
    get: (id: string) => call<Design>("GET", `/api/designs/${id}`),
    change: (id: string, ops: DesignOp[]) => call<Design & { made: { sections: string[]; frames: string[] }; lint: Record<string, DesignLint[]> }>("PATCH", `/api/designs/${id}`, { ops }),
    undo: (id: string) => call<Design>("PATCH", `/api/designs/${id}`, { undo: true }),
    restore: (id: string) => call<Design>("PATCH", `/api/designs/${id}`, { restore: true }),
    duplicate: (id: string) => call<Design>("POST", `/api/designs/${id}/duplicate`),
    remove: (id: string) => call<{ ok: true }>("DELETE", `/api/designs/${id}`),
    /** The sheet, a section or a frame as a PNG to download. */
    pictureUrl: (id: string, o: { section?: string; frame?: string; scale?: 1 | 2 } = {}) => `/api/designs/${id}/picture?${new URLSearchParams(Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))}`,
    codeUrl: (id: string, o: { section?: string } = {}) => `/api/designs/${id}/code${o.section ? `?section=${encodeURIComponent(o.section)}` : ""}`,
    bundleUrl: (id: string, o: { section?: string } = {}) => `/api/designs/${id}/bundle${o.section ? `?section=${encodeURIComponent(o.section)}` : ""}`,
  },
  voice: {
    config: () => call<VoiceConfig>("GET", "/api/voice/config"),
    save: (b: Partial<Omit<VoiceConfig, "key">> & { apiKey?: string; clearKey?: boolean }) => call<VoiceConfig>("PUT", "/api/voice/config", b),
    voices: () => call<{ provider: string; label: string; available: boolean; voices: { id: string; label: string }[]; models?: { id: string; family?: string | null }[] }>("GET", "/api/voice/voices"),
    /** Speak one sentence and return the audio. Errors carry the provider's one-line fix. */
    async test(text: string, voice?: string): Promise<{ url: string; durationMs: number }> {
      const res = await fetch("/api/voice/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice }) });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new ApiError(res.status, j?.error?.kind ?? "error", j?.error?.message ?? "That voice did not answer."); }
      return { url: URL.createObjectURL(await res.blob()), durationMs: Number(res.headers.get("x-duration-ms") ?? 0) };
    },
    generate: (patternId: string, b: { lines: (string | { say: string; show?: string })[]; voice?: string; speed?: number; startMs?: number; gapMs?: number; captions?: boolean }) => call<JobItem>("POST", `/api/patterns/${patternId}/voiceover`, b),
  },
  knit: {
    start: (patternId: string, params: KnitParams) => call<JobItem>("POST", `/api/patterns/${patternId}/knit`, { params }),
    preview: (patternId: string, params: KnitParams) => call<{ units: { label: string; size: Size; issues: KnitIssue[] }[] }>("POST", `/api/patterns/${patternId}/knit`, { params, dryRun: true }),
    job: (id: string) => call<JobItem>("GET", `/api/jobs/${id}`),
    /** What is knitting or waiting to, in one project or in all of them. */
    active: (projectId?: string) => call<JobItem[]>("GET", `/api/jobs?kind=knit&active=1${projectId ? `&project=${projectId}` : ""}`),
    cancel: (id: string) => call<JobItem>("DELETE", `/api/jobs/${id}`),
    list: (projectId: string, q: { pattern?: string; batch?: string } = {}) => call<KnitRecord[]>("GET", `/api/projects/${projectId}/knits?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`),
    remove: (id: string) => call<{ ok: true }>("DELETE", `/api/knits/${id}`),
    tag: (id: string, tags: string[]) => call<KnitRecord>("PATCH", `/api/knits/${id}`, { tags }),
    /** The person has looked at it: its New badge goes. */
    seen: (id: string) => call<KnitRecord>("PATCH", `/api/knits/${id}`, { seen: true }),
    /** One the person likes, to find again with the Favourites filter; or not any more. */
    favorite: (id: string, favorite: boolean) => call<KnitRecord>("PATCH", `/api/knits/${id}`, { favorite }),
    allSeen: (projectId: string) => call<{ marked: number }>("POST", `/api/projects/${projectId}/knits/seen`, {}),
    writePost: (id: string, ask?: string) => call<KnitRecord>("POST", `/api/knits/${id}/post`, ask ? { ask } : {}),
    setPost: (id: string, post: { caption?: string; hashtags?: string[]; audioId?: string | null }) => call<KnitRecord>("PUT", `/api/knits/${id}/post`, post),
  },
  agent: {
    config: () => call<ModelConfig>("GET", "/api/agent/model"),
    save: (b: Partial<Pick<ModelConfig, "model" | "maxTurns" | "maxKnits">> & { apiKey?: string; clearKey?: boolean }) => call<ModelConfig>("PUT", "/api/agent/model", b),
    test: () => call<{ ok: true }>("POST", "/api/agent/model/test", {}),
    /** What the person's key has spent through knitted, and the limits on it. */
    usage: () => call<UsageSummary>("GET", "/api/agent/usage"),
    setLimits: (l: Partial<SpendLimits>) => call<UsageSummary>("PUT", "/api/agent/usage", l),
    /** The path of the MCP address for Claude Code and other MCP clients, key included. POST makes a new one. */
    mcp: () => call<{ path: string }>("GET", "/api/agent/mcp"),
    newMcpAddress: () => call<{ path: string }>("POST", "/api/agent/mcp", {}),
    start: (b: { projectId: string; patternId?: string; prompt: string; mode?: "edit" | "suggest"; model?: string }) => call<AgentJob>("POST", "/api/agent", b),
    job: (id: string) => call<AgentJob>("GET", `/api/jobs/${id}`),
    cancel: (id: string) => call<AgentJob>("DELETE", `/api/jobs/${id}`),
    /** What models have been doing lately; subscribeAgent keeps up with it. */
    activity: () => call<AgentState>("GET", "/api/agent/activity"),
    /** While paused, a model's edits are refused and it is told to wait for the person. */
    pause: (paused: boolean) => call<AgentState>("POST", "/api/agent/activity", { paused }),
  },
  /** Conversations with your model: Ask, and the editor's Ask panel. Each message is answered by a run, read like `agent.job`. */
  chats: {
    list: (q: { pattern?: string; project?: string } = {}) => call<ChatItem[]>("GET", `/api/chats?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`),
    get: (id: string) => call<ChatDetail>("GET", `/api/chats/${id}`),
    /** A new chat and its first message. `projectId` null: the whole studio. */
    start: (b: { projectId?: string | null; patternId?: string; prompt: string; mode?: "edit" | "suggest"; model?: string }) => call<{ chat: ChatItem; job: AgentJob }>("POST", "/api/chats", b),
    /** The next message. `patternId`: the pattern open in the editor, which the message is about. */
    send: (id: string, b: { prompt: string; mode?: "edit" | "suggest"; patternId?: string; model?: string }) => call<AgentJob>("POST", `/api/chats/${id}/messages`, b),
    remove: (id: string) => call<{ ok: true }>("DELETE", `/api/chats/${id}`),
  },
  /** Photos and video made by a provider, on the person's own key. */
  generate: {
    config: () => call<GenConfig>("GET", "/api/generate/config"),
    saveKey: (provider: GenProvider, b: { apiKey?: string; clearKey?: boolean }) => call<GenConfig>("PUT", "/api/generate/config", { provider, ...b }),
    choose: (choice: Partial<GenConfig["choice"]>) => call<GenConfig>("PUT", "/api/generate/config", { choice }),
    test: (provider: GenProvider) => call<{ ok: true } | { ok: false; why: string }>("POST", "/api/generate/test", { provider }),
    estimate: (projectId: string, b: GenRequest) => call<{ plan: GenPlanView }>("POST", `/api/projects/${projectId}/generate`, { ...b, estimate: true }),
    start: (projectId: string, b: GenRequest) => call<{ job: GenJob; plan: GenPlanView }>("POST", `/api/projects/${projectId}/generate`, b),
    job: (id: string) => call<GenJob>("GET", `/api/jobs/${id}`),
  },
  /** Free stock: photos, video and sound from Openverse, Pixabay and Pexels. */
  stock: {
    config: () => call<StockConfig>("GET", "/api/stock/config"),
    saveKey: (provider: StockProvider, b: { apiKey?: string; clearKey?: boolean }) => call<StockConfig>("PUT", "/api/stock/config", { provider, ...b }),
    search: (q: { q: string; kind: StockKind; page?: number }) =>
      call<StockSearch>("GET", `/api/stock/search?${new URLSearchParams({ q: q.q, kind: q.kind, page: String(q.page ?? 1) })}`),
    /** Into a project's Yarn, or the Library's (`to`: LIBRARY_ID). The same file again is the one there. */
    add: (b: { id: string; kind: StockKind; to: string; folder?: string; name?: string }) => call<{ yarn: Yarn; existing: boolean }>("POST", "/api/stock/add", b),
  },
  /** The person's accounts on social platforms, their developer apps, and the media host. */
  social: {
    config: () => call<SocialConfigView>("GET", "/api/social/config"),
    save: (b: SocialConfigChange) => call<SocialConfigView>("PUT", "/api/social/config", b),
    accounts: () => call<SocialAccount[]>("GET", "/api/social/accounts"),
    disconnect: (id: string) => call<{ ok: true }>("DELETE", `/api/social/accounts/${id}`),
    /** Where to send the person to sign in: opened in their browser. */
    connect: (platform: Platform) => call<{ url: string }>("POST", `/api/social/connect/${platform}`, {}),
    /** What the site's page showed to paste, when the browser could not come back by itself. */
    paste: (text: string) => call<SocialAccount>("POST", "/api/social/callback", { text }),
    /** TikTok's choices for this account now: who may see a post, and what it may allow. */
    creator: (accountId: string) => call<TikTokCreator>("GET", `/api/social/accounts/${accountId}/creator`),
    testHost: () => call<{ url: string }>("POST", "/api/social/host/test", {}),
  },
  posts: {
    list: (projectId: string) => call<SocialPost[]>("GET", `/api/projects/${projectId}/posts`),
    /** A post to each account. `captions` and `options`: by platform, where one differs. `at` null: now. */
    create: (projectId: string, b: NewPosts) => call<SocialPost[]>("POST", `/api/projects/${projectId}/posts`, b),
    update: (id: string, b: PostChange) => call<SocialPost>("PATCH", `/api/posts/${id}`, b),
    cancel: (id: string) => call<SocialPost>("POST", `/api/posts/${id}/cancel`, {}),
    remove: (id: string) => call<{ ok: true }>("DELETE", `/api/posts/${id}`),
    /** Ask its platform how it is doing now, rather than at its next time. */
    checkMetrics: (id: string) => call<SocialPost>("POST", `/api/posts/${id}/metrics`, {}),
    /** How posts did, and what the person's own posts say works: for one project, or all. */
    insights: (projectId?: string) => call<Insights>("GET", `/api/insights${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
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
export const yarnThumbUrl = (y: Pick<Yarn, "id" | "hash">, size?: "tile" | "top") => `/api/yarn/${y.id}/thumb?v=${y.hash.slice(0, 10)}${size ? `&size=${size}` : ""}`;
/** A bigger preview, 960 pixels on its longest side, for one picture shown large: a project's card. */
export const yarnPictureUrl = (y: Pick<Yarn, "id" | "hash">) => `/api/yarn/${y.id}/thumb?size=large&v=${y.hash.slice(0, 10)}`;
/** One page of a PDF, drawn about `px` pixels on its longest side. Pages count from 1. */
export const pdfPageUrl = (y: Pick<Yarn, "id" | "hash">, page: number, px = 1600) => `/api/yarn/${y.id}/page?n=${page}&px=${px}&v=${y.hash.slice(0, 10)}`;

export interface UploadHandle { promise: Promise<{ yarn: Yarn; existing: boolean }>; cancel: () => void; }

/**
 * Upload one file with real progress. `fetch` cannot report upload progress, so
 * this uses XMLHttpRequest. The file is the raw request body (not multipart) so
 * the server can stream it to disk, and cancelling aborts the request, which the
 * server turns into a cleaned-up temp file.
 */
export function uploadYarn(projectId: string, file: File, onProgress: (fraction: number) => void, opts: { replaceId?: string; folder?: string; shelf?: Shelf } = {}): UploadHandle {
  const xhr = new XMLHttpRequest();
  const into = (opts.folder ? `&folder=${encodeURIComponent(opts.folder)}` : "") + (opts.shelf && opts.shelf !== "yarn" ? `&shelf=${opts.shelf}` : "");
  const url = opts.replaceId ? `/api/yarn/${opts.replaceId}/file?filename=${encodeURIComponent(file.name)}` : `/api/projects/${projectId}/yarn?filename=${encodeURIComponent(file.name)}${into}`;
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

export interface SyncOptions {
  url?: string; writeUp?: string; reference?: boolean; mode?: "merge" | "replace";
  profile?: boolean; pictures?: boolean; swatch?: boolean; activateSwatch?: boolean; devices?: ("desktop" | "mobile")[]; maxPages?: number;
}
export type SyncStep = "read" | "swatch" | "profile" | "pictures";
export interface SyncStepState { status: "waiting" | "running" | "done" | "skipped" | "failed"; note?: string }
/** A sync with the website, step by step: the pages read so far, the pictures taken, and the newest of the profile as it is written. */
export interface SyncJob {
  id: string; kind: "sync"; status: JobItem["status"]; projectId: string | null; error: string | null;
  progress: { current: SyncStep | "done"; steps: Record<SyncStep, SyncStepState>; pages: { url: string; title: string }[]; shots: { done: number; total: number }; live: string; chars: number } | null;
  result: { brief: Brief; swatchId: string | null; pictures: number; skipped: number; notes: string[] } | null; createdAt: string; finishedAt: string | null;
}
export interface KnitParams { sizes?: Size[]; format?: "png" | "jpeg" | "webp" | "mp4"; scale?: 1 | 2; fps?: 30 | 60; rows?: Record<string, string>[]; reuse?: boolean; }
export interface JobItem {
  id: string; kind: string; status: "queued" | "running" | "done" | "failed" | "cancelled" | "interrupted"; projectId: string | null; error: string | null;
  progress: { total: number; done: number; current: string | null; units: { label: string; status: string; issues: KnitIssue[]; knitId?: string }[]; step?: string; frames?: { done: number; total: number } | null } | null;
  /** What it was asked to do: for a knit, which pattern. */
  input?: { patternId?: string; patternName?: string } | null;
  result: { knitIds: string[]; failed: number } | null; createdAt: string; finishedAt: string | null;
}
export const knitFileUrl = (k: { id: string }, download = false) => `/api/knits/${k.id}/file${download ? "?download=1" : ""}`;
export type { KnitRecord, KnitIssue };
export type { SpendLimits, UsageSummary };

export type { SocialAccount, SocialPost, PostChange, Platform, Insights };
export interface SocialConfigView {
  apps: Record<Platform, { clientId: string; secret: boolean }>;
  host: {
    kind: "none" | "s3" | "filefreak";
    s3: { endpoint: string; region: string; bucket: string; keyId: string; publicBase: string; prefix: string; secret: boolean };
    filefreak: { folder: string; apiKey: boolean };
  };
  modelMaySchedule: boolean;
  /** Ask X for each post's numbers, which X charges for. */
  metricsX: boolean;
  /** Keep the desktop app running without its window while posts wait to go out. */
  stayOpen: boolean;
  /** This server's port: the redirect TikTok and YouTube come back to has it. */
  port: number;
}
export interface SocialConfigChange {
  apps?: Partial<Record<Platform, { clientId?: string; clientSecret?: string; clearSecret?: boolean }>>;
  host?: { kind?: "none" | "s3" | "filefreak"; s3?: Partial<{ endpoint: string; region: string; bucket: string; keyId: string; publicBase: string; prefix: string; secret: string }>; filefreak?: Partial<{ folder: string; apiKey: string }> };
  modelMaySchedule?: boolean;
  metricsX?: boolean;
  stayOpen?: boolean;
}
export interface TikTokCreator { creator_nickname?: string; creator_username?: string; creator_avatar_url?: string; privacy_level_options?: string[]; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean; max_video_post_duration_sec?: number }
export interface NewPosts {
  accountIds: string[]; knitIds: string[]; caption: string; title?: string;
  captions?: Partial<Record<Platform, string>>; options?: Partial<Record<Platform, Record<string, unknown>>>;
  at?: string | null; draft?: boolean;
}

export interface VoiceConfig {
  provider: "system" | "openai" | "piper"; voice: string; speed: number; baseUrl: string; model: string;
  /** How to say it, in words: sent to a voice server as `instructions`. */
  style?: string;
  /** Anything else the voice server takes, sent as it is. */
  options?: Record<string, unknown>;
  key: { present: boolean; source: "environment" | "keychain" | "none"; backend: string | null; canStore: boolean };
}

type KeyStatus = { present: boolean; source: "environment" | "keychain" | "none"; backend: string | null; canStore: boolean };
export interface GenConfig { sources: (GenSource & { key: KeyStatus })[]; choice: { image: { provider: GenProvider; model: string } | null; video: { provider: GenProvider; model: string } | null } }
export interface GenRequest { kind: GenKind; prompt: string; from?: string[]; count?: number; aspect?: GenAspect; quality?: GenQuality; seconds?: number; transparent?: boolean; name?: string; folder?: string; tags?: string[] }
export interface GenJob { id: string; status: JobItem["status"]; error: string | null; progress: { step: "asking" | "keeping" | "done"; say: string } | null; result: { yarn: { id: string; name: string }[]; cost: number } | null }
export interface GenPlanView { kind: GenKind; provider: GenProvider; model: string; count: number; aspect: GenAspect; quality: GenQuality; seconds: number; cost: number; say: string }
export interface StockConfig { sources: (StockSource & { key: KeyStatus | null })[] }
/** What a search found, and how each source answered: `state` none means it was not asked (no key, or not that kind). */
export interface StockSearch { items: StockItem[]; sources: { provider: StockProvider; name: string; state: "ok" | "error" | "no-key" | "none"; note?: string; more: boolean }[] }

export interface ModelConfig {
  model: string; maxTurns: number; maxKnits: number; models: { id: string; label: string }[];
  key: { present: boolean; source: "environment" | "keychain" | "none"; backend: string | null; canStore: boolean };
}
/** `note`: what the model says between its tool calls, about what it found and will do next. */
export type AgentEvent = { type: "text"; text: string } | { type: "note"; text: string } | { type: "tool_call"; name: string; input: unknown; say?: string } | { type: "tool_result"; name: string; summary: string } | { type: "refusal"; slot: string; why: string } | { type: "stopped"; why: string } | { type: "model"; model: string; name: string; why?: string; switched?: boolean };
/** A pattern a run changed (or made, `made`), with its revision from before the run: what Undo all puts back. */
export interface ChangedPattern { patternId: string; projectId: string; name: string; baselineRevisionId: string | null; count: number; made: boolean; }
export interface AgentJob {
  id: string; status: JobItem["status"]; error: string | null; createdAt?: string; updatedAt?: string;
  input?: { prompt: string; mode?: "edit" | "suggest"; patternId?: string; chatId?: string };
  progress: { current: string | null; events: AgentEvent[] } | null;
  result: {
    text: string; turns: number; toolCalls: number; refusals: { tool: string; slot?: string; why: string }[]; stopped: string | null; usage: unknown;
    patternId: string | null; originalPatternId: string | null; suggestion: string | null; baselineRevisionId: string | null; changedCount: number;
    /** When the model declined to answer: the reason Anthropic gave, if one. Missing from runs made before chats. */
    declined?: { category: string | null } | null; changed?: ChangedPattern[]; knitIn?: string[];
    /** The model it ended on, each it was on in turn, and how many tokens its last request held. Missing from runs made before Auto. */
    model?: string; models?: string[]; context?: number;
  } | null;
}
export interface ChatItem {
  id: string; title: string; projectId: string | null; patternId: string | null; createdAt: string; updatedAt: string;
  /** Whether its newest message is still being answered. */
  running: boolean;
  project: { id: string; name: string } | null;
  /** The pattern it is on: the one its newest message was about, else the one it started on. */
  pattern: { id: string; name: string; projectId: string } | null;
}
/** A chat with its turns: each the run that answered a message, the message in its `input`. */
export interface ChatDetail extends ChatItem { turns: AgentJob[]; }

export interface BackupItem { name: string; bytes: number; createdAt: string; kind: "daily" | "manual" | "pre-migration"; }
