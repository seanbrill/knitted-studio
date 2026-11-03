// What a new project starts with. Patterns are authored in fractions of the
// frame, so one set of coordinates serves every size.

import type { Size, Stitch } from "./types.ts";
import { SIZES } from "./types.ts";

type Draft = Omit<Stitch, "id">;
const id = (n: string) => `st_${n}`;

function launchStitches(size: Size): Stitch[] {
  const tall = size.h / size.w > 1.2;
  const wide = size.w / size.h > 1.2;
  const mk = (n: string, d: Draft): Stitch => ({ id: id(n), ...d });
  return [
    mk("bg", { kind: "image", slot: "backdrop", x: 0, y: 0, w: 1, h: 1, locked: false, style: { background: "$color.primary" } }),
    mk("eyebrow", {
      kind: "text", slot: "eyebrow", x: 0.08, y: wide ? 0.3 : tall ? 0.62 : 0.55, w: 0.6, h: 0.04, locked: true, content: "NEW THIS WEEK",
      style: { fontFamily: "$font.mono", fontSize: 0.022, letterSpacing: 0.14, textTransform: "uppercase", color: "$color.text" },
    }),
    mk("headline", {
      kind: "text", slot: "headline", x: 0.08, y: wide ? 0.38 : tall ? 0.67 : 0.6, w: wide ? 0.6 : 0.84, h: wide ? 0.34 : tall ? 0.16 : 0.22, locked: false,
      content: "Make it knitted.", style: { fontFamily: "$font.display", fontSize: wide ? 0.11 : 0.085, fontWeight: 800, color: "$color.text" },
    }),
    mk("logo", { kind: "image", slot: "logo", x: 0.08, y: 0.88, w: wide ? 0.14 : 0.26, h: 0.05, locked: true, style: { fit: "contain" } }),
  ];
}

export interface StarterPattern { name: string; size: Size; stitches: Stitch[]; }

export function socialStarterPack(): StarterPattern[] {
  return SIZES.map((size) => ({ name: `Launch ${size.name.toLowerCase()}`, size, stitches: launchStitches(size) }));
}

export function blankPattern(size: Size = SIZES[0]): StarterPattern {
  return { name: "Untitled pattern", size, stitches: [] };
}

export const EXAMPLE_SWATCH = {
  name: "knitted",
  colors: ["#DF5A0F", "#D92414", "#5C1410", "#FFB347", "#17110B"],
  fonts: { display: "Bricolage Grotesque", body: "Geist", mono: "Geist Mono" },
};
