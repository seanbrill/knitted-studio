// The vocabulary, as types.
//
// The theme document fixes these words for the UI, the docs AND the API, so
// they are the type names too. A `Prefab` type beside a "Pattern" button is
// how a vocabulary stops being consistent.
//
//   Pattern  a prefab: a saved, reusable layout with locked brand slots
//   Swatch   a brand kit: colours, fonts, logos and voice for one brand
//   Yarn     raw assets: photos, logos, video, copy
//   Stitch   a single element in a pattern (text box, image slot, shape)
//   Knit     the verb for producing an output

import type { FolderSection } from "./folders-pure.ts";

export type ColorRole = "primary" | "secondary" | "accent" | "neutral" | "background" | "text";
export const COLOR_ROLES: ColorRole[] = ["primary", "secondary", "accent", "neutral", "background", "text"];

export interface SwatchColor { role: ColorRole; name: string; hex: string; }
/** A font is a bundled family by name, or an uploaded font Yarn. */
export interface FontRef { family: string; yarnId?: string; }
export type LogoUse = "full" | "mark" | "mono-light" | "mono-dark";

/**
 * A brand kit. Stitches reference it by ROLE, not by value (`$color.primary`),
 * so changing the Swatch restyles every Pattern in the project at once. That is
 * the whole point of having one.
 */
export interface Swatch {
  id: string;
  projectId: string;
  name: string;
  colors: SwatchColor[];
  fonts: { display: FontRef; body: FontRef; mono?: FontRef };
  logos: { yarnId: string; use: LogoUse }[];
  /** How this brand writes. Fed verbatim to a model when it drafts copy. */
  voice: { summary: string; do: string[]; dont: string[]; examples: string[] };
  rules: { cornerRadius: number; heatGrade?: { hue: "ember" | "red"; strength: number } };
  /** The folder it is filed in, in the Swatch tab: "Seasonal/Summer". "" is the top. */
  folder: string;
  createdAt: string;
  updatedAt: string;
}

export type YarnKind = "image" | "video" | "audio" | "font" | "copy" | "pdf";
/** Where a file is kept: Yarn, to use in patterns, or the Brief's reference, for a model to look at. */
export type Shelf = "yarn" | "reference";

/** A raw asset. */
export interface Yarn {
  id: string;
  projectId: string;
  kind: YarnKind;
  shelf: Shelf;
  /** What it is called in knitted. A rename never touches the file on disk. */
  name: string;
  /** Path relative to the project's yarn directory. Never absolute. */
  file: string;
  originalName: string;
  mime: string;
  bytes: number;
  /** sha-256 of the bytes: how a re-upload of the same file is recognised. */
  hash: string;
  width?: number;
  height?: number;
  durationMs?: number;
  tags: string[];
  /** The folder it is filed in: "Royalty free music/Lo-fi". "" is the top of Yarn. Filing it never touches the file. */
  folder: string;
  /** Derived facts: dominant colours, waveform peaks, fps, font family, a thumbnail file. */
  meta: YarnMeta;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Where a stock file came from, kept with it: the credit is the line to give when it is used. */
/** How a file was made: by whom, from what it was asked for, and what it was drawn from. */
export interface MadeBy {
  /** "model": drawn by the person's model, as SVG. "provider": made by an image or video service. */
  by: "model" | "provider";
  provider?: string;
  model?: string;
  /** What was asked for, in the words given. */
  prompt?: string;
  /** Files it was made from, like a mascot's reference picture. */
  from?: { id: string; name: string }[];
  at: string;
  /** What it cost, in US dollars, where a provider charges. */
  costUsd?: number;
}

export interface StockCredit {
  provider: string; id: string; page: string; author?: string; authorUrl?: string;
  license: string; licenseUrl?: string; credit: string; at: string;
}

/** A part of a picture or a page: fractions of its width and height, from its top left corner. */
export interface CropBox { x: number; y: number; w: number; h: number; }

export interface YarnMeta {
  thumb?: string;
  colors?: string[];
  hasAlpha?: boolean;
  peaks?: number[];
  fps?: number;
  hasAudio?: boolean;
  family?: string;
  weight?: number;
  text?: string;
  /** A PDF's pages, and how much text it has: none, and it is pictures of pages, like a scan. */
  pages?: number;
  textChars?: number;
  /** A picture cut from another file: which, from which page of a PDF, and what part of it. */
  from?: { id: string; name: string; page?: number; box: CropBox };
  /** A picture of a page of the business's website, as a visitor sees it: which page, on what, and when. */
  site?: { url: string; device: "desktop" | "mobile"; at: string };
  /** Free stock, from a source like Pexels: where it came from, who made it, its licence, and the credit to give. */
  stock?: StockCredit;
  /** Made here rather than brought in: drawn by a model as SVG, or made by a provider from a prompt. */
  made?: MadeBy;
  /** Plain-language problems found at import, shown beside the file. */
  warnings?: string[];
}

/**
 * What a model knows about a project's brand, beside its Swatch: a profile of it, in
 * markdown, built from its website or written by a person, and the reference to look at
 * (Yarn on the reference shelf, listed apart).
 */
export interface Brief {
  projectId: string;
  profile: string;
  /** What the person wrote for the builder to go on, kept for the next build. */
  notes: string;
  source: BriefSource;
  /** Who changed the profile last. */
  by: "human" | "model";
  builtAt: string | null;
  updatedAt: string | null;
  /** Whether Undo has a profile to go back to. */
  canUndo: boolean;
  /** The business's website, and what its last sync did. */
  site: BriefSite;
}
/** What the last sync with the website did, step by step, so it can be run again from there. */
export interface BriefSite {
  url?: string;
  syncedAt?: string;
  /** Pages read, and pictures taken of them. */
  pages?: number;
  pictures?: number;
  /** The swatch it read from the site, when it was asked to. */
  swatchId?: string;
}
/** Where a profile came from: built from a website, or written. `pages`: what was read. */
export interface BriefSource {
  kind?: "site" | "written";
  url?: string;
  model?: string;
  pages?: { url: string; title: string }[];
  /** Pages it could not read, or was asked not to, and other things to know about the build. */
  notes?: string[];
  /** Reference files it read as well, by name. */
  reference?: string[];
}

export type StitchKind = "text" | "image" | "shape" | "video" | "audio" | "part";

/**
 * One element in a Pattern.
 *
 * `locked` is the whole product in one field. A locked Stitch is drawn with
 * the dashed ember outline and cannot be moved or restyled by whoever uses the
 * Pattern - it is what the brand decided once. A free Stitch is solid-bordered
 * and is theirs to change. Every screen should make that difference obvious,
 * which is only possible if it is a real property rather than a convention.
 */
export interface Stitch {
  id: string;
  kind: StitchKind;
  /** Fractions of the frame, 0-1, never pixels: a Pattern is resolution-free. */
  x: number;
  y: number;
  w: number;
  h: number;
  locked: boolean;
  /** Text content, or a Yarn id for the media kinds. */
  content?: string;
  yarnId?: string;
  style?: Record<string, string | number>;
  /** Named so a model can fill it: "headline", "logo", "product shot". */
  slot?: string;
  // A `part` stitch is an INSTANCE of a Part dropped into this Pattern.
  partId?: string;
  /** The Part version this instance last saw. If the Part moves on, the editor offers to review. */
  partVersion?: number;
  /** Values for the Part's slots, by slot name. Text, or a Yarn id for image slots. */
  overrides?: Record<string, string>;
  /** A snapshot of the Part's slot definitions, so locks are enforced without loading the Part. */
  partSlots?: PartSlot[];
}

/** An output size. Named, because "1080x1920" is not a thing people say. */
export interface Size {
  name: string;
  w: number;
  h: number;
}

/**
 * The Library: what every project shares, as a project of its own that is never listed with
 * the others. Its Yarn shows in every project's Yarn, beside the project's own.
 */
export const LIBRARY_ID = "library";

export const SIZES: Size[] = [
  { name: "Story", w: 1080, h: 1920 },
  { name: "Post", w: 1080, h: 1350 },
  { name: "Square", w: 1080, h: 1080 },
  { name: "Landscape", w: 1920, h: 1080 },
  { name: "Banner", w: 1456, h: 816 },
];

/** What a size is called: the named size of the same shape, at any scale, or null for another shape. */
export function sizeNamed(w: number, h: number): string | null {
  return SIZES.find((s) => Math.abs(w * s.h - h * s.w) <= 0.01 * h * s.w)?.name ?? null;
}
/** Every shape a knit can be found by: the named sizes, and the rest. */
export const KNIT_SIZES = [...SIZES.map((s) => s.name), "Other"] as const;

/**
 * A reusable layout. The thing the product is named after.
 *
 * `html` and `css` are optional and are the escape hatch: a Pattern can be a
 * hand-written component rather than a stack of Stitches, which is how the
 * animated ones work. Both are rendered in the same frame-by-frame engine, so
 * a Pattern made of Stitches and one made of code are the same kind of thing
 * downstream.
 */
export interface Pattern {
  id: string;
  projectId: string;
  name: string;
  size: Size;
  stitches: Stitch[];
  /** Milliseconds. 0 means a still. */
  durationMs: number;
  html?: string;
  css?: string;
  /** Animation and sound: clips on a timeline, driven by the engine's clock. */
  motion?: Motion;
  /** Increments on every applied change. Stale writes are detected with it. */
  version: number;
  /** The folder it is filed in, in the project's Patterns. "" is the top. Not part of its history. */
  folder: string;
  updatedAt: string;
  /** Set when this is a Part open in the editor: every change goes to that Part. Not in Patterns. */
  partId?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  swatchId: string | null;
  coverYarnId: string | null;
  /** The seeded example. Deletable like any other project. */
  example: boolean;
  archivedAt: string | null;
  /** Soft delete: the row and its files remain until purged, which is what makes Undo real. */
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Who is acting. The lock rule is decided by this and nothing else. */
export type Actor =
  | "human" //  a person in Pattern mode: the brand owner, may change anything
  | "fill" //   a person in Fill mode: uses the pattern, cannot touch locked stitches
  | "model" //  a model, through MCP or the in-app loop
  | "import" // a bulk importer
  | "system";

/** What a project's activity log records. The project page has words for each one, and the type makes it. */
export type ActivityAction =
  | "project.created" | "project.renamed" | "project.picture" | "project.duplicated" | "project.deleted"
  | "pattern.created" | "pattern.duplicated" | "pattern.deleted" | "edit.refused"
  | "yarn.imported" | "yarn.changed" | "yarn.deleted" | "yarn.shared" | "swatch.created" | "part.created"
  | "design.created" | "design.duplicated" | "design.deleted"
  | "folder.created" | "folder.filed" | "folder.renamed" | "folder.deleted"
  | "brief.built" | "brief.changed" | "brief.synced"
  | "comment.added" | "comment.replied" | "comment.resolved";

/** Who wrote a comment or a reply. */
export type CommentAuthor = "human" | "model";
export interface CommentReply { id: string; text: string; author: CommentAuthor; createdAt: string; updatedAt: string }
/** A comment pinned to a knit or a frame of a design sheet, and the replies to it (comments.ts). */
export interface CommentThread {
  id: string;
  /** Its number on what it is on, from 1, oldest first: the number on its pin. */
  n: number;
  projectId: string;
  knitId: string | null; designId: string | null; frameId: string | null;
  /** What it is on, by name: the knit's label or the sheet's name; and the frame's name, on a sheet. */
  on: string; frameName: string | null;
  /** Where: fractions of the picture or the frame across and down. Null for a comment on the whole thing. */
  x: number | null; y: number | null;
  /** The moment in a video, in milliseconds. */
  timeMs: number | null;
  text: string; author: CommentAuthor; createdAt: string; updatedAt: string;
  resolvedAt: string | null;
  replies: CommentReply[];
}

/** A refused change. Always returned, always logged, never swallowed. */
export interface Refusal {
  stitchId?: string;
  slot?: string;
  why: string;
}

/** What a Knit produced. */
export interface Knit {
  id: string;
  patternId: string;
  /** Output files, relative to the project's output directory. */
  files: string[];
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export type PartKind = "stitches" | "code";
/** Where a model's call works: what the studio points at and highlights while it does. */
export interface AgentWhere {
  projectId?: string; patternId?: string; stitchIds?: string[]; yarnId?: string; partId?: string; swatchId?: string;
  designId?: string;
  /** The frames of that design it works on, by id. */
  frameIds?: string[];
  jobId?: string; section?: FolderSection;
  /** The folders of that section it works on: one it files things into, or one it renames, as it is called now. */
  folders?: string[];
  /** The folder to open to watch it: where it files things, or the one a folder it renames is in. "" is the top. */
  folder?: string;
  /** The things it moves, by id, of any section: each view outlines its own. */
  thingIds?: string[];
}
/** One call a model made, as the studio shows it: who, what, where, and how it ended. */
export interface AgentCall {
  id: string;
  /** Which model: "Claude Code", or "Your model" for the studio's own. */
  client: string;
  tool: string;
  /** What it is doing, in words: "Filling headline on Story". */
  summary: string;
  /** Whether it changes anything. Reading, checking and previewing do not. */
  edits: boolean;
  where: AgentWhere;
  state: "running" | "done" | "refused" | "failed";
  /** Why it was refused or failed, in a line. */
  note?: string;
  startedAt: string;
  endedAt?: string;
}
/**
 * What the studio's own model is writing in one run, as it writes it: a note between its
 * steps about what it found and will do next, or its answer. The editor shows it beside
 * the canvas, so a person sees what it is thinking with the chat closed.
 */
export interface AgentLive {
  /** The run it is writing in: a job. */
  jobId: string;
  client: string;
  /** The pattern or design it works on now: the one asked about, then whichever its newest step works on. */
  where: { projectId?: string | null; patternId?: string | null; designId?: string | null };
  /** The conversation it answers in, to open when it is done. */
  chatId?: string | null;
  /** Working on a copy (Suggest only): the pattern it was asked from. */
  from?: string | null;
  kind: "note" | "text";
  /** The newest of it, the last few hundred characters. Empty while it thinks before writing. */
  text: string;
  /** Whether that note or answer is finished: what a screen reader is told. */
  done: boolean;
  /** How the run ended, for its last words to stay a moment after. Absent while it runs. */
  ended?: "done" | "failed" | "cancelled";
  at: string;
}
/** What models have been doing lately, oldest first, and whether the person has paused them. */
export interface AgentState { paused: boolean; calls: AgentCall[]; live?: AgentLive[]; }

export type PartCategory = "text" | "media" | "motion" | "frame" | "cta" | "other";
export interface PartSlot { name: string; kind: "text" | "image"; default?: string; locked: boolean; }

/**
 * A reusable fragment smaller than a Pattern: a lower-third, a quote block, a
 * logo sting. Pattern > Part > Stitch.
 *
 * Child stitches use coordinates relative to the Part's OWN box (0 to 1), and
 * their sizes are fractions of the Part's width, so an instance can be dragged
 * bigger or smaller and everything inside scales with it.
 */
export interface Part {
  id: string;
  /** null means the library: available in every project. */
  projectId: string | null;
  builtin: boolean;
  name: string;
  description: string;
  category: PartCategory;
  tags: string[];
  kind: PartKind;
  stitches: Stitch[];
  /** kind "code": hand-written markup and styles, rendered in a sandbox with no script. */
  html?: string;
  css?: string;
  slots: PartSlot[];
  /** Width over height of the Part's box. */
  aspect: number;
  durationMs: number;
  version: number;
  /** The folder it is filed in, in Parts. A library part is in the same folder in every project. The starter parts are at the top. */
  folder: string;
  createdAt: string;
  updatedAt: string;
}

export type Ease = "linear" | "ease-out" | "ease-in" | "ease-in-out" | "back-out" | "spring-soft";
export type Preset =
  | "fade-in" | "fade-out" | "slide-up" | "slide-down" | "slide-left" | "slide-right"
  | "pop" | "scale-in" | "stitch-in" | "type-on" | "wipe" | "ken-burns" | "pulse"
  | "slide-out-up" | "slide-out-down" | "slide-out-left" | "slide-out-right" | "shrink-out" | "wipe-out";

/** One thing a stitch does, and when. Times are milliseconds from the start of the Pattern. */
export interface Clip { id: string; startMs: number; endMs: number; preset: Preset; ease?: Ease; params?: Record<string, number>; }

/** A sound on the timeline: a voiceover, or music underneath it. */
export interface AudioClip {
  id: string; yarnId: string; startMs: number; kind: "voice" | "music"; gain?: number; fadeInMs?: number; fadeOutMs?: number; loop?: boolean; label?: string;
  /** Where in the file it starts playing, in ms: a track's chorus rather than its quiet opening. 0 if left out. */
  fromMs?: number;
}

export interface Motion {
  /** Keyed by stitch id. */
  tracks: Record<string, Clip[]>;
  audio?: AudioClip[];
}
