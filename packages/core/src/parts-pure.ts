// Part maths that needs no database: making a Part out of a selection, turning an
// instance back into stitches, and linting hand-written Parts. Browser-safe.

import type { Part, PartCategory, PartSlot, Stitch } from "./types.ts";
import { union, toPx, toFrac } from "./geometry.ts";

const FRACTIONAL = ["fontSize", "radius", "borderWidth", "letterSpacing_px"] as const;
const rid = () => `st_${Math.random().toString(36).slice(2, 9)}`;

/** Fractions of the frame width become fractions of the Part's width (and back). */
function rescale(style: Stitch["style"], factor: number): Stitch["style"] {
  if (!style) return style;
  const out = { ...style };
  for (const k of FRACTIONAL) if (typeof out[k] === "number") out[k] = Math.round((out[k] as number) * factor * 1e5) / 1e5;
  return out;
}

export interface PartDraft { name: string; description?: string; category?: PartCategory; stitches: Stitch[]; slots: PartSlot[]; aspect: number; }

/**
 * Turn a selection into a Part plus an instance that replaces it.
 * Every selected stitch that has a slot name becomes a Part slot, defaulting to
 * unlocked; `lockedSlots` names the ones the brand owner wants locked.
 */
export function partFromStitches(selection: Stitch[], frame: { w: number; h: number }, o: { name: string; category?: PartCategory; description?: string; lockedSlots?: string[] }): { draft: PartDraft; box: { x: number; y: number; w: number; h: number } } {
  if (!selection.length) throw new Error("Select something first.");
  const px = selection.map((s) => toPx(s, frame));
  const b = union(px)!;
  const box = toFrac(b, frame);
  const children: Stitch[] = selection.map((s) => {
    const rel = { x: (s.x - box.x) / box.w, y: (s.y - box.y) / box.h, w: s.w / box.w, h: s.h / box.h };
    return { ...s, ...rel, style: rescale(s.style, 1 / box.w), locked: false };
  });
  const slots: PartSlot[] = children.filter((s) => s.slot && (s.kind === "text" || s.kind === "image")).map((s) => ({
    name: s.slot!, kind: s.kind as "text" | "image", default: s.kind === "text" ? s.content : s.yarnId, locked: !!o.lockedSlots?.includes(s.slot!),
  }));
  return { draft: { name: o.name, description: o.description, category: o.category ?? "other", stitches: children, slots, aspect: (b.w) / (b.h) }, box };
}

/** The stitch that stands for a Part inside a Pattern. */
export function instanceOf(part: Pick<Part, "id" | "version" | "slots" | "name">, box: { x: number; y: number; w: number; h: number }, slotName: string): Stitch {
  return { id: rid(), kind: "part", slot: slotName, x: box.x, y: box.y, w: box.w, h: box.h, locked: false, partId: part.id, partVersion: part.version, overrides: {}, partSlots: part.slots };
}

/** A name for an instance that is unique in the pattern: lower_third, lower_third_2, ... */
export function uniqueSlotName(base: string, taken: Iterable<string | undefined>): string {
  const root = base.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9]/, "p$&").slice(0, 32) || "part";
  const set = new Set(taken);
  if (!set.has(root)) return root;
  for (let n = 2; n < 200; n++) if (!set.has(`${root}_${n}`)) return `${root}_${n}`;
  return `${root}_${Date.now() % 10000}`;
}

/**
 * Break an instance into plain stitches in the Pattern, so it can be edited
 * freely. Slot names are prefixed with the instance's, keeping them unique.
 */
export function detachInstance(inst: Stitch, part: Part): Stitch[] {
  return part.stitches.map((c) => {
    const text = c.slot && inst.overrides?.[c.slot];
    return {
      ...c, id: rid(), x: inst.x + c.x * inst.w, y: inst.y + c.y * inst.h, w: c.w * inst.w, h: c.h * inst.h,
      slot: c.slot ? `${inst.slot ?? "part"}_${c.slot}` : undefined, locked: inst.locked,
      ...(c.kind === "text" && text ? { content: text } : {}), ...(c.kind === "image" && text ? { yarnId: text } : {}),
      style: rescale(c.style, inst.w),
    };
  });
}

// ── a Part written in code must stay deterministic, safe and offline ─────────
export interface PartLint { level: "error" | "warning"; message: string; }
const RULES: [RegExp, "error" | "warning", string][] = [
  [/<\s*script\b/i, "error", "Scripts are not allowed in a Part. Use CSS animation instead, so every frame renders the same way."],
  [/\son[a-z]+\s*=/i, "error", "Event handlers (onclick and friends) are not allowed in a Part."],
  [/\b(setTimeout|setInterval|requestAnimationFrame|Date\.now|performance\.now|Math\.random|new Date)\b/, "error", "That uses the clock or randomness, which makes every render different. Drive motion with CSS animation."],
  [/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/, "error", "A Part cannot reach the network. Renders have to be reproducible."],
  [/(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i, "error", "A Part cannot load anything from the web. Upload it as Yarn and use a slot instead."],
  [/@import\b/i, "error", "@import is not allowed in a Part."],
  [/<\s*(iframe|object|embed|link|meta|base|form)\b/i, "error", "That element is not allowed in a Part."],
  [/animation-iteration-count\s*:\s*infinite/i, "warning", "An infinite animation loops forever. Set a number of repeats so the render has a clear end."],
  [/\{\{\s*[^}]*[^a-z0-9_}\s][^}]*\}\}/i, "warning", "Slot placeholders are {{name}}, with lowercase letters, numbers and underscores."],
];
export function lintCodePart(html: string, css: string): PartLint[] {
  const text = `${html}\n${css}`;
  return RULES.filter(([re]) => re.test(text)).map(([, level, message]) => ({ level, message }));
}
export const hasLintErrors = (l: PartLint[]) => l.some((x) => x.level === "error");

/** `{{slot}}` placeholders in a code Part's markup, with values escaped. */
export function fillTemplate(html: string, values: Record<string, string>): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return html.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, (_, k) => esc(values[k] ?? ""));
}
