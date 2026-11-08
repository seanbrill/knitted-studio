// What a design sheet is drawn with, read from its code: the brand's colours, fonts and corners
// (the tokens every frame may use), how much each is used and where, and the values written
// out by hand: type sizes and weights, corners, spacing, shadows, and any colour that is not
// one of the brand's. The legend in a sheet's download is drawn from this.

import { readableOn } from "./contrast.ts";
import type { Design } from "./design-pure.ts";
import { colorFor, fontFor } from "./tokens.ts";
import { COLOR_ROLES, type Swatch } from "./types.ts";

export interface StyleUse { value: string; uses: number; frames: string[] }
export interface TokenUse extends StyleUse { variable: string; label: string }
export interface DesignStyles {
  colors: TokenUse[];
  /** Colours written out in the code, with the token they match when they are one of the brand's. */
  otherColors: (StyleUse & { sameAs: string | null })[];
  fonts: (TokenUse & { family: string })[];
  /** Font families named in the code rather than through a token. */
  otherFamilies: StyleUse[];
  sizes: (StyleUse & { px: number | null })[];
  weights: StyleUse[];
  radii: TokenUse[];
  otherRadii: StyleUse[];
  spacing: (StyleUse & { px: number })[];
  shadows: StyleUse[];
}

const ROLE_LABELS: Record<string, string> = { primary: "Primary", secondary: "Secondary", accent: "Accent", neutral: "Neutral", background: "Background", text: "Text" };
const COLOR_LITERAL = /#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{3,4}\b|\b(?:rgba?|hsla?)\([^)]*\)/gi;
const decl = (prop: string) => new RegExp(`(?:^|[;{\\s"'])${prop}\\s*:\\s*([^;}"]+)`, "gi");

/** A colour as one form to compare by: #rrggbb, lower case, from #rgb too. */
function normal(c: string): string {
  const v = c.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${[...v.slice(1)].map((x) => x + x).join("")}`;
  return v.replace(/\s+/g, "");
}

class Tally {
  private m = new Map<string, { uses: number; frames: Set<string> }>();
  add(value: string, frame: string) {
    const v = value.trim(); if (!v) return;
    const e = this.m.get(v) ?? { uses: 0, frames: new Set<string>() };
    e.uses++; e.frames.add(frame); this.m.set(v, e);
  }
  get(value: string) { return this.m.get(value); }
  list(): StyleUse[] { return [...this.m].map(([value, e]) => ({ value, uses: e.uses, frames: [...e.frames] })).sort((a, b) => b.uses - a.uses); }
}

const pxOf = (v: string): number | null => {
  const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "rem" || m[2] === "em" ? n * 16 : n;
};

/** The pieces of a `font:` shorthand that say its weight and size. */
function shorthand(v: string): { weight?: string; size?: string } {
  const parts = v.replace(/var\([^)]*\)|"[^"]*"|'[^']*'/g, " ").trim().split(/\s+/);
  const out: { weight?: string; size?: string } = {};
  for (const p of parts) {
    if (!out.weight && /^(\d{3}|bold|bolder|lighter)$/.test(p)) out.weight = p;
    else if (!out.size && /^[\d.]+(px|rem|em|%)(\/.*)?$/.test(p)) out.size = p.split("/")[0];
  }
  return out;
}

/** What the sheet is drawn with, from every frame's CSS and HTML. */
export function designStyles(design: Pick<Design, "sections">, swatch: Swatch): DesignStyles {
  const frames = design.sections.flatMap((s) => s.frames);
  const vars = new Tally(), colors = new Tally(), families = new Tally(), sizes = new Tally(), weights = new Tally(), radii = new Tally(), spacing = new Tally(), shadows = new Tally();
  for (const f of frames) {
    const code = `${f.css}\n${f.html}`;
    for (const m of code.matchAll(/var\(\s*(--[\w-]+)/g)) vars.add(m[1]!, f.name);
    // Colours written out, but not the stand-in a var() falls back on to.
    for (const m of code.replace(/var\([^)]*\)/g, "").matchAll(COLOR_LITERAL)) colors.add(normal(m[0]), f.name);
    for (const m of code.matchAll(decl("font-family"))) { const v = m[1]!.trim(); if (!/^var\(/.test(v)) families.add(v.replace(/\s+/g, " "), f.name); }
    for (const m of code.matchAll(decl("font-size"))) sizes.add(m[1]!.trim(), f.name);
    for (const m of code.matchAll(decl("font-weight"))) weights.add(m[1]!.trim(), f.name);
    for (const m of code.matchAll(decl("font"))) { const s = shorthand(m[1]!); if (s.size) sizes.add(s.size, f.name); if (s.weight) weights.add(s.weight, f.name); }
    for (const m of code.matchAll(decl("border-radius"))) { const v = m[1]!.trim(); if (!/^var\(--radius/.test(v)) radii.add(v, f.name); }
    for (const m of code.matchAll(decl("(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?"))) {
      for (const t of m[1]!.trim().split(/\s+/)) { const n = pxOf(t); if (n != null && n > 0) spacing.add(`${n}px`, f.name); }
    }
    for (const m of code.matchAll(decl("box-shadow"))) { const v = m[1]!.trim(); if (v !== "none") shadows.add(v.replace(/\s+/g, " "), f.name); }
  }
  const token = (variable: string, label: string, value: string): TokenUse => {
    const u = vars.get(variable);
    return { variable, label, value, uses: u?.uses ?? 0, frames: u ? [...u.frames] : [] };
  };
  const text = colorFor(swatch, "text"), bg = colorFor(swatch, "background");
  const brandColors = [
    ...COLOR_ROLES.map((r) => token(`--color-${r}`, ROLE_LABELS[r] ?? r, colorFor(swatch, r))),
    ...(["primary", "secondary", "accent", "neutral"] as const).map((r) => token(`--color-on-${r}`, `On ${ROLE_LABELS[r]!.toLowerCase()}`, readableOn(colorFor(swatch, r), text, bg))),
  ];
  const byHex = new Map(brandColors.map((c) => [normal(c.value), c.variable]));
  const radius = Math.max(0, Math.min(48, Math.round((swatch.rules?.cornerRadius ?? 0.012) * 1080)));
  return {
    colors: brandColors,
    otherColors: colors.list().map((c) => ({ ...c, sameAs: byHex.get(c.value) ?? null })),
    fonts: (["display", "body", "mono"] as const).map((slot) => ({ ...token(`--font-${slot}`, slot === "display" ? "Display" : slot === "body" ? "Body" : "Mono", fontFor(swatch, slot)), family: fontFor(swatch, slot) })),
    otherFamilies: families.list(),
    sizes: sizes.list().map((s) => ({ ...s, px: pxOf(s.value) })).sort((a, b) => (b.px ?? -1) - (a.px ?? -1)),
    weights: weights.list().sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)),
    radii: [token("--radius-sm", "Small", `${Math.round(radius / 2)}px`), token("--radius", "Corner", `${radius}px`), token("--radius-lg", "Large", `${radius * 2}px`)],
    otherRadii: radii.list(),
    spacing: spacing.list().map((s) => ({ ...s, px: Number.parseFloat(s.value) })).sort((a, b) => a.px - b.px),
    shadows: shadows.list(),
  };
}
