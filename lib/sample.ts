// One real Pattern and one real Swatch, so the studio opens on something.
//
// Per the design rules: a tool "opens in a realistic working state ... so the
// first look shows what it does". An empty canvas behind an empty inspector
// demonstrates nothing, and this is plainly an example rather than anybody's
// real brand.

import type { Pattern, Swatch } from "./types";
import { SIZES } from "./types";

export const SAMPLE_SWATCH: Swatch = {
  id: "sw_knitted",
  name: "knitted",
  colors: ["#DF5A0F", "#D92414", "#5C1410", "#FFB347", "#0B0A09"],
  fonts: { display: "Bricolage Grotesque", body: "Geist", mono: "Geist Mono" },
  logos: [],
  voice: "Short, warm and confident. Craft verbs: knit, stitch, pattern, finish.",
};

export const SAMPLE_PATTERN: Pattern = {
  id: "pt_launch_story",
  projectId: "pj_sample",
  name: "Launch story",
  size: SIZES[0], // Story, 1080x1920
  durationMs: 0,
  updatedAt: new Date(0).toISOString(),
  stitches: [
    {
      id: "st_bg",
      kind: "image",
      slot: "backdrop",
      x: 0, y: 0, w: 1, h: 1,
      locked: true,
    },
    {
      id: "st_eyebrow",
      kind: "text",
      slot: "eyebrow",
      x: 0.08, y: 0.62, w: 0.6, h: 0.04,
      locked: true,
      content: "NEW THIS WEEK",
    },
    {
      id: "st_headline",
      kind: "text",
      slot: "headline",
      x: 0.08, y: 0.67, w: 0.84, h: 0.16,
      locked: false,
      content: "Make it knitted.",
    },
    {
      id: "st_logo",
      kind: "image",
      slot: "logo",
      x: 0.08, y: 0.88, w: 0.26, h: 0.05,
      locked: true,
    },
  ],
};
