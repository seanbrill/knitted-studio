// Quality gates: the product judging its own output, because the person using it
// cannot. Pure functions over a Pattern, so they run before a render (cheap, no
// browser) and are the same checks the editor can show while you work.
//
// Per the brief, a check that cannot fail is worse than none, so every gate here
// has a test with a deliberately bad input.

import type { Pattern, Swatch, Yarn } from "./types.ts";
import type { KnitIssue } from "./knits.ts";
import { colorFor, resolveStyle } from "./tokens.ts";
import { ratio } from "./contrast.ts";
import { motionLint } from "./motion.ts";

export interface PreflightOpts { scale?: number; yarn: Record<string, Yarn | undefined>; }

const hexOf = (v: unknown): string | null => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);

/** The colour behind a stitch: the backdrop's, else the swatch background. Good enough to judge text against. */
function groundFor(p: Pattern, sw: Swatch): string {
  const bg = p.stitches.find((s) => s.slot === "backdrop" || (s.x <= 0.001 && s.y <= 0.001 && s.w >= 0.99 && s.h >= 0.99));
  const c = bg ? hexOf(resolveStyle(sw, bg.style).background) : null;
  return c ?? colorFor(sw, "background");
}

export function preflight(p: Pattern, sw: Swatch, o: PreflightOpts): KnitIssue[] {
  const issues: KnitIssue[] = [];
  const scale = o.scale ?? 1;
  const add = (i: KnitIssue) => issues.push(i);
  const ground = groundFor(p, sw);
  for (const s of p.stitches) {
    const st = resolveStyle(sw, s.style);
    if (st.hidden) continue;
    const name = s.slot ?? s.kind;
    if (s.kind === "image" || s.kind === "video") {
      if (s.yarnId) {
        const y = o.yarn[s.yarnId];
        if (!y || y.deletedAt) { add({ level: "error", code: "missing-yarn", stitchId: s.id, slot: s.slot, message: `The ${name} uses Yarn that was deleted. Choose another file for it.` }); continue; }
        // Rendered size in pixels at this scale, against the file's own pixels.
        const wantW = s.w * p.size.w * scale;
        if (y.width && y.mime !== "image/svg+xml" && y.width < wantW * 0.8) add({ level: "warning", code: "low-res", stitchId: s.id, slot: s.slot, message: `The ${name} image is ${y.width}px wide but is drawn ${Math.round(wantW)}px wide, so it will look soft. Use a larger file.` });
      } else if (s.slot && s.slot !== "backdrop") {
        add({ level: "warning", code: "empty-image-slot", stitchId: s.id, slot: s.slot, message: `The ${name} slot has no image yet, so it will be empty in the knit.` });
      }
    }
    if (s.kind === "text") {
      if (!(s.content ?? "").trim()) add({ level: "warning", code: "empty-text", stitchId: s.id, slot: s.slot, message: `The ${name} text is empty.` });
      const fg = hexOf(st.color) ?? colorFor(sw, "text");
      const r = ratio(fg, ground);
      const size = Number(st.fontSize ?? 0.05) * p.size.w;
      const large = size >= 56 || (size >= 42 && Number(st.fontWeight ?? 400) >= 700);
      const need = large ? 3 : 4.5;
      if (r < need) add({ level: "warning", code: "low-contrast", stitchId: s.id, slot: s.slot, message: `The ${name} text is ${r.toFixed(1)}:1 against what is behind it. It needs ${need}:1 to read easily. Try a different colour from your swatch.` });
    }
    if (s.x < -0.01 || s.y < -0.01 || s.x + s.w > 1.01 || s.y + s.h > 1.01) {
      if (!(s.slot === "backdrop")) add({ level: "warning", code: "off-canvas", stitchId: s.id, slot: s.slot, message: `The ${name} runs past the edge of the frame, so part of it will be cut off.` });
    }
  }
  for (const a of p.motion?.audio ?? []) {
    const y = o.yarn[a.yarnId];
    if (!y || y.deletedAt) issues.push({ level: "error", code: "missing-yarn", message: `The ${a.kind === "voice" ? "voiceover" : "music"} "${a.label ?? "sound"}" uses a file that was deleted. Choose another or remove it.` });
  }
  for (const m of motionLint(p)) issues.push({ level: "warning", code: m.code, stitchId: m.stitchId, message: m.message });
  return issues;
}

export interface MeasuredText { stitchId: string; slot?: string; overflow: boolean; }
/** Turn the page's own measurements (does each text box fit its text?) into issues. */
export function overflowIssues(measured: MeasuredText[]): KnitIssue[] {
  return measured.filter((m) => m.overflow).map((m) => ({ level: "warning" as const, code: "text-overflow", stitchId: m.stitchId, slot: m.slot, message: `The ${m.slot ?? "text"} does not fit its box and will be cut off. Shorten it, make the box bigger, or turn on "shrink to fit".` }));
}

export interface PostCheckInput {
  kind: "image" | "video"; width: number; height: number; expectW: number; expectH: number;
  blank?: boolean; pixFmt?: string; frames?: number; expectFrames?: number; videoMs?: number; audioMs?: number | null;
}
/** Verify an output after it exists. Each failure says what is wrong in the product's own words. */
export function postflight(i: PostCheckInput): { issues: KnitIssue[]; checks: string[] } {
  const issues: KnitIssue[] = []; const checks: string[] = [];
  const bad = (code: string, message: string) => issues.push({ level: "error", code, message });
  checks.push("dimensions");
  if (i.width !== i.expectW || i.height !== i.expectH) bad("wrong-size", `The file came out ${i.width}x${i.height} but the pattern is ${i.expectW}x${i.expectH}.`);
  if (i.blank !== undefined) { checks.push("not-blank"); if (i.blank) bad("blank", "The file came out as one flat colour. Something in the pattern did not draw."); }
  if (i.kind === "video") {
    checks.push("pixel-format");
    if (i.pixFmt && i.pixFmt !== "yuv420p") bad("pixel-format", `The video is ${i.pixFmt}, which plays as a green screen on phones. It must be yuv420p.`);
    if (i.expectFrames !== undefined && i.frames !== undefined) { checks.push("frame-count"); if (i.frames !== i.expectFrames) bad("frame-count", `The video has ${i.frames} frames but the timeline needs ${i.expectFrames}.`); }
    if (i.audioMs != null && i.videoMs != null) { checks.push("audio-length"); if (i.audioMs + 50 < i.videoMs) bad("audio-short", "The audio is shorter than the picture, so the end of the video would be silent."); }
  }
  return { issues, checks };
}

export const hasErrors = (issues: KnitIssue[]) => issues.some((i) => i.level === "error");
