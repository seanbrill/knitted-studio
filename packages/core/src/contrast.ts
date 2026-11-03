// WCAG 2 contrast, in one place. The theme checker (scripts/check-contrast.mjs),
// the Swatch editor, and the Knit quality gates all use THIS, so a pair cannot
// pass in one and fail in another.

export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export type Grade = "AAA" | "AA" | "AA large" | "fail";
export const grade = (r: number): Grade => (r >= 7 ? "AAA" : r >= 4.5 ? "AA" : r >= 3 ? "AA large" : "fail");

export const isHex = (s: unknown): s is string => typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

/**
 * The nearest colour to `fg` (same hue, nudged in lightness) that reaches `min`
 * against `bg`. This is the one-click fix behind "Text on Primary: 3.7:1 fails".
 */
export function suggestPassing(fg: string, bg: string, min = 4.5): string | null {
  if (ratio(fg, bg) >= min) return fg;
  const [h, s, l] = toHsl(fg);
  // Try both directions, smallest change first: white on ember cannot get any
  // lighter, but it can get darker, and that is the fix the theme itself uses.
  for (let step = 1; step <= 100; step++) {
    for (const dir of [1, -1]) {
      const nl = l + (dir * step) / 100;
      if (nl < 0 || nl > 1) continue;
      const c = fromHsl(h, s, nl);
      if (ratio(c, bg) >= min) return c;
    }
  }
  for (const extreme of ["#000000", "#ffffff"]) if (ratio(extreme, bg) >= min) return extreme;
  return null;
}

/** Black-ish or white-ish, whichever reads better on `bg`. */
export function readableOn(bg: string, dark = "#17110b", light = "#ffffff"): string {
  return ratio(dark, bg) >= ratio(light, bg) ? dark : light;
}
