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
  createdAt: string;
  updatedAt: string;
}

export type YarnKind = "image" | "video" | "audio" | "font" | "copy";

/** A raw asset. */
export interface Yarn {
  id: string;
  projectId: string;
  kind: YarnKind;
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
  /** Derived facts: dominant colours, waveform peaks, fps, font family, a thumbnail file. */
  meta: YarnMeta;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

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
  /** Plain-language problems found at import, shown beside the file. */
  warnings?: string[];
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

export const SIZES: Size[] = [
  { name: "Story", w: 1080, h: 1920 },
  { name: "Post", w: 1080, h: 1350 },
  { name: "Square", w: 1080, h: 1080 },
  { name: "Landscape", w: 1920, h: 1080 },
  { name: "Banner", w: 1456, h: 816 },
];

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
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
}

export type Ease = "linear" | "ease-out" | "ease-in" | "ease-in-out" | "back-out" | "spring-soft";
export type Preset =
  | "fade-in" | "fade-out" | "slide-up" | "slide-down" | "slide-left" | "slide-right"
  | "pop" | "scale-in" | "stitch-in" | "type-on" | "wipe" | "ken-burns" | "pulse";

/** One thing a stitch does, and when. Times are milliseconds from the start of the Pattern. */
export interface Clip { id: string; startMs: number; endMs: number; preset: Preset; ease?: Ease; params?: Record<string, number>; }

/** A sound on the timeline: a voiceover, or music underneath it. */
export interface AudioClip { id: string; yarnId: string; startMs: number; kind: "voice" | "music"; gain?: number; fadeInMs?: number; fadeOutMs?: number; loop?: boolean; label?: string; }

export interface Motion {
  /** Keyed by stitch id. */
  tracks: Record<string, Clip[]>;
  audio?: AudioClip[];
}
