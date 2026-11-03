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

/** A brand kit. One per brand, shared by every Pattern in a Project. */
export interface Swatch {
  id: string;
  name: string;
  /** 3-5 colours, shown as overlapping dots on the chip. */
  colors: string[];
  fonts: { display: string; body: string; mono?: string };
  /** Yarn ids of logo files. */
  logos: string[];
  /** How this brand writes. Fed to the model when it drafts copy. */
  voice?: string;
}

export type YarnKind = "image" | "video" | "audio" | "font" | "copy";

/** A raw asset. */
export interface Yarn {
  id: string;
  projectId: string;
  kind: YarnKind;
  name: string;
  /** Path relative to the project's asset directory. */
  path: string;
  bytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  addedAt: string;
}

export type StitchKind = "text" | "image" | "shape" | "video" | "audio";

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
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  swatchId: string | null;
  createdAt: string;
  updatedAt: string;
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
