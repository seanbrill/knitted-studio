// Design tokens in a Pattern: how a Stitch says "the brand's primary colour"
// instead of a hex. Browser-safe and pure, so the editor, the thumbnail renderer
// and the engine all resolve identically.
//
//   "$color.primary"   a colour role from the Swatch
//   "$font.display"    a font slot from the Swatch ("display" | "body" | "mono")
//   "$radius"          the Swatch's corner radius, in fractions of the frame width

import type { ColorRole, Swatch } from "./types.ts";

const DEFAULT_FONT = (family: string) => ({ family });

/** What a project without a Swatch looks like. The knitted brand, so nothing is ever unstyled. */
export const FALLBACK_SWATCH: Swatch = {
  id: "sw_fallback", projectId: "", name: "knitted",
  colors: [
    { role: "primary", name: "Ember", hex: "#df5a0f" }, { role: "secondary", name: "Red", hex: "#d92414" },
    { role: "accent", name: "Glow", hex: "#ffb347" }, { role: "neutral", name: "Oxblood", hex: "#5c1410" },
    { role: "background", name: "Warm white", hex: "#fffbf6" }, { role: "text", name: "Warm black", hex: "#17110b" },
  ],
  fonts: { display: DEFAULT_FONT("Bricolage Grotesque"), body: DEFAULT_FONT("Geist"), mono: DEFAULT_FONT("Geist Mono") },
  logos: [], voice: { summary: "", do: [], dont: [], examples: [] }, rules: { cornerRadius: 0.012 }, createdAt: "", updatedAt: "",
};

export function colorFor(swatch: Swatch, role: ColorRole): string {
  return (swatch.colors.find((c) => c.role === role) ?? FALLBACK_SWATCH.colors.find((c) => c.role === role)!).hex;
}

export function fontFor(swatch: Swatch, slot: "display" | "body" | "mono"): string {
  return (swatch.fonts[slot] ?? FALLBACK_SWATCH.fonts[slot]!).family;
}

/** Resolve one style value. Anything that is not a token passes through untouched. */
export function resolveToken(swatch: Swatch, value: string | number | undefined): string | number | undefined {
  if (typeof value !== "string" || !value.startsWith("$")) return value;
  const [kind, name] = value.slice(1).split(".");
  if (kind === "color") return colorFor(swatch, name as ColorRole);
  if (kind === "font") return fontFor(swatch, name as "display" | "body" | "mono");
  if (kind === "radius") return swatch.rules.cornerRadius;
  return value;
}

export function resolveStyle(swatch: Swatch, style: Record<string, string | number> | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(style ?? {})) out[k] = resolveToken(swatch, v) as string | number;
  return out;
}

/** Which tokens does a style use? For "this swatch change affects N stitches". */
export const isToken = (v: unknown): v is string => typeof v === "string" && v.startsWith("$");
