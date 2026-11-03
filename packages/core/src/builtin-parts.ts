// The starter Parts that ship with knitted. They use brand TOKENS, never hex, so
// they take on whatever Swatch is active. Child coordinates are relative to the
// Part's own box; font sizes are fractions of the Part's width.

import type { Part, PartCategory, PartSlot, Stitch } from "./types.ts";

type Draft = Omit<Part, "id" | "projectId" | "builtin" | "version" | "createdAt" | "updatedAt" | "durationMs" | "tags" | "kind"> & { durationMs?: number; tags?: string[] };
const t = (slot: string | undefined, content: string, x: number, y: number, w: number, h: number, style: Record<string, string | number>): Stitch =>
  ({ id: `c_${slot ?? Math.random().toString(36).slice(2, 7)}`, kind: "text", slot, x, y, w, h, locked: false, content, style });
const shape = (id: string, x: number, y: number, w: number, h: number, style: Record<string, string | number>): Stitch => ({ id, kind: "shape", x, y, w, h, locked: false, style });
const slot = (name: string, def: string, locked = false): PartSlot => ({ name, kind: "text", default: def, locked });

export const BUILTIN_PARTS: Draft[] = [
  { name: "Lower third", description: "A name and a title, for the bottom of a video or story.", category: "text", aspect: 4, slots: [slot("name", "Your name"), slot("title", "Your title")], stitches: [
    shape("bar", 0, 0, 1, 1, { background: "$color.primary", radius: 0.05 }),
    t("name", "Your name", 0.06, 0.12, 0.88, 0.45, { fontFamily: "$font.display", fontSize: 0.1, fontWeight: 800, color: "$color.background", lineHeight: 1, verticalAlign: "bottom" }),
    t("title", "Your title", 0.06, 0.6, 0.88, 0.3, { fontFamily: "$font.body", fontSize: 0.055, fontWeight: 500, color: "$color.background" }),
  ] },
  { name: "Pull quote", description: "A big quote with the person it came from.", category: "text", aspect: 1.5, slots: [slot("quote", "Make it knitted."), slot("by", "Someone, somewhere")], stitches: [
    t("quote", "Make it knitted.", 0, 0, 1, 0.72, { fontFamily: "$font.display", fontSize: 0.12, fontWeight: 800, color: "$color.text", lineHeight: 1, letterSpacing: -0.03 }),
    t("by", "Someone, somewhere", 0, 0.8, 1, 0.14, { fontFamily: "$font.mono", fontSize: 0.04, fontWeight: 500, color: "$color.primary", letterSpacing: 0.12, textTransform: "uppercase" }),
  ] },
  { name: "Headline stack", description: "A small mono kicker over a heavy headline: the theme's marketing pairing.", category: "text", aspect: 3, slots: [slot("eyebrow", "NEW THIS WEEK"), slot("headline", "A headline that earns its space")], stitches: [
    t("eyebrow", "NEW THIS WEEK", 0, 0, 1, 0.14, { fontFamily: "$font.mono", fontSize: 0.035, fontWeight: 500, color: "$color.primary", letterSpacing: 0.14, textTransform: "uppercase" }),
    t("headline", "A headline that earns its space", 0, 0.2, 1, 0.8, { fontFamily: "$font.display", fontSize: 0.1, fontWeight: 800, color: "$color.text", lineHeight: 0.95, letterSpacing: -0.03 }),
  ] },
  { name: "Call to action", description: "A pill-shaped prompt. Not the app's primary button: this is for your posts.", category: "cta", aspect: 4, slots: [slot("label", "Shop now")], stitches: [
    shape("pill", 0, 0, 1, 1, { background: "$color.accent", radius: 0.12 }),
    t("label", "Shop now", 0, 0, 1, 1, { fontFamily: "$font.body", fontSize: 0.1, fontWeight: 800, color: "$color.text", textAlign: "center", verticalAlign: "middle", letterSpacing: 0 }),
  ] },
  { name: "Stat callout", description: "One big number and what it means.", category: "text", aspect: 1.3, slots: [slot("number", "12k"), slot("label", "makers knitting")], stitches: [
    t("number", "12k", 0, 0, 1, 0.7, { fontFamily: "$font.display", fontSize: 0.34, fontWeight: 800, color: "$color.primary", lineHeight: 0.9, letterSpacing: -0.04 }),
    t("label", "makers knitting", 0, 0.74, 1, 0.22, { fontFamily: "$font.body", fontSize: 0.075, fontWeight: 600, color: "$color.text" }),
  ] },
  { name: "Price tag", description: "A price with what it was.", category: "cta", aspect: 1.6, slots: [slot("price", "$29"), slot("was", "was $49")], stitches: [
    shape("tag", 0, 0, 1, 1, { background: "$color.primary", radius: 0.08 }),
    t("price", "$29", 0.08, 0.1, 0.84, 0.55, { fontFamily: "$font.display", fontSize: 0.2, fontWeight: 800, color: "$color.background", lineHeight: 1 }),
    t("was", "was $49", 0.08, 0.68, 0.84, 0.22, { fontFamily: "$font.body", fontSize: 0.07, fontWeight: 600, color: "$color.background" }),
  ] },
  { name: "Badge", description: "A round sticker for 'new', 'sale', 'free'.", category: "frame", aspect: 1, slots: [slot("text", "NEW")], stitches: [
    shape("disc", 0, 0, 1, 1, { shape: "ellipse", background: "$color.accent" }),
    t("text", "NEW", 0, 0, 1, 1, { fontFamily: "$font.display", fontSize: 0.24, fontWeight: 800, color: "$color.text", textAlign: "center", verticalAlign: "middle" }),
  ] },
  { name: "Stitch divider", description: "A single row of stitches: the product's one allowed motif, used as a rule.", category: "frame", aspect: 14, slots: [], stitches: [
    shape("row", 0, 0, 1, 1, { shape: "chevrons", color: "$color.neutral", count: 18 }),
  ] },
  { name: "Logo lockup", description: "Your logo with a line beneath it.", category: "media", aspect: 3, slots: [{ name: "logo", kind: "image", locked: true }, slot("tagline", "Pattern once. Knit forever.")], stitches: [
    { id: "c_logo", kind: "image", slot: "logo", x: 0, y: 0, w: 0.5, h: 0.6, locked: false, style: { fit: "contain" } },
    t("tagline", "Pattern once. Knit forever.", 0, 0.68, 1, 0.3, { fontFamily: "$font.body", fontSize: 0.05, fontWeight: 600, color: "$color.text" }),
  ] },
  { name: "Caption bar", description: "A subtitle strip for the bottom of a video.", category: "text", aspect: 6, slots: [slot("caption", "Say it in one line")], stitches: [
    shape("strip", 0, 0, 1, 1, { background: "$color.text", radius: 0.1, opacity: 0.88 }),
    t("caption", "Say it in one line", 0.04, 0, 0.92, 1, { fontFamily: "$font.body", fontSize: 0.05, fontWeight: 700, color: "$color.background", textAlign: "center", verticalAlign: "middle", lineHeight: 1.15 }),
  ] },
];

export const BUILTIN_VERSION = 1;
export type BuiltinCategory = PartCategory;
