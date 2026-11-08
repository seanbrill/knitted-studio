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
import { codeOnScreen, spokenProblem } from "./spoken.ts";

export interface PreflightOpts { scale?: number; yarn: Record<string, Yarn | undefined>; /** The frame rate asked for: 60, or left to the footage. */ fps?: number; }

/**
 * The rate footage shot at `fps` plays at without holding any frame longer than the rest:
 * 29.97 is 30 near enough (one frame in 33 s), and 50 and 60 halve evenly. Null for an odd one.
 */
export function cleanRate(fps: number | undefined): 24 | 25 | 30 | null {
  if (!fps) return null;
  const near = (rates: number[]) => rates.some((r) => Math.abs(fps - r) < 0.05);
  return near([23.976, 24, 47.952, 48]) ? 24 : near([25, 50]) ? 25 : near([29.97, 30, 59.94, 60]) ? 30 : null;
}

const footageIn = (p: Pattern, yarn: Record<string, Yarn | undefined>) =>
  p.stitches.flatMap((s) => { const y = s.kind === "video" && s.yarnId && !s.style?.hidden ? yarn[s.yarnId] : undefined; return y && !y.deletedAt && y.kind === "video" ? [{ s, y }] : []; });

/**
 * The frame rate to knit a video at. Drawn at 30 a second, footage shot at 25 holds one frame in
 * six for two, a hitch on every pan, and 13 of 24 footage reels in a real library had footage at
 * 24 or 25. So when all of a video's footage shares 24 or 25, the video is knitted at that rate
 * and no frame repeats; otherwise at 30, or at 60 when that is asked for.
 */
export function videoFps(p: Pattern, yarn: Record<string, Yarn | undefined>, asked?: number): number {
  if (asked === 60) return 60;
  const rates = new Set(footageIn(p, yarn).map(({ y }) => cleanRate(y.meta?.fps)));
  const [only] = rates;
  return rates.size === 1 && (only === 24 || only === 25) ? only : 30;
}

const hexOf = (v: unknown): string | null => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);

/**
 * The colour a text stitch is read against: its own background, else the topmost thing under
 * its middle that covers most of it (a button, a card, a terminal), else the page. Null when
 * that is a picture, a video, a part or a gradient: there is no one colour to judge before
 * it is drawn, and a number made up for it is worse than none. Judged against the page alone,
 * every dark-on-pink button read 1.0:1, and 189 such warnings were all wrong.
 */
function groundFor(p: Pattern, sw: Swatch, text: Pattern["stitches"][number]): string | null {
  const own = resolveStyle(sw, text.style);
  if (own.background) return hexOf(own.background);
  const cx = text.x + text.w / 2, cy = text.y + text.h / 2;
  const below = p.stitches.slice(0, p.stitches.indexOf(text)).reverse();
  for (const s of below) {
    const st = resolveStyle(sw, s.style);
    if (st.hidden || Number(st.opacity ?? 1) < 0.5) continue;
    const overlapW = Math.max(0, Math.min(s.x + s.w, text.x + text.w) - Math.max(s.x, text.x));
    const overlapH = Math.max(0, Math.min(s.y + s.h, text.y + text.h) - Math.max(s.y, text.y));
    const covers = cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h && overlapW * overlapH >= 0.5 * text.w * text.h;
    if (!covers) continue;
    // A picture box with no file yet shows its own colour; with one, the picture.
    if (((s.kind === "image" || s.kind === "video") && s.yarnId) || s.kind === "part") return null;
    if (st.background) return hexOf(st.background);
  }
  return colorFor(sw, "background");
}

/**
 * Every style key something draws. The renderer (packages/render/src/pure.mjs) is the
 * one place that reads them, and a test holds this list to what it reads, so a key that
 * is stored and never drawn (`fontsize` for fontSize) is a warning, not a silent no-op.
 */
export const STYLE_KEYS = [
  "background", "blend", "blur", "borderColor", "borderWidth", "brightness", "color", "contrast", "count", "fit", "flipX", "focalX", "focalY", "fromMs",
  "fontFamily", "fontSize", "fontWeight", "heat", "heatGrade", "heatStrength", "hidden", "letterSpacing", "lineHeight", "maxLines", "opacity",
  "radius", "rotate", "saturate", "shadow", "shape", "textAlign", "textTransform", "verticalAlign",
] as const;
const KNOWN_STYLE = new Set<string>(STYLE_KEYS);
const fold = (k: string) => k.toLowerCase().replace(/[^a-z]/g, "");

export function preflight(p: Pattern, sw: Swatch, o: PreflightOpts): KnitIssue[] {
  const issues: KnitIssue[] = [];
  const scale = o.scale ?? 1;
  const add = (i: KnitIssue) => issues.push(i);
  for (const s of p.stitches) {
    const st = resolveStyle(sw, s.style);
    if (st.hidden) continue;
    const name = s.slot ?? s.kind;
    const unknown = Object.keys(s.style ?? {}).filter((k) => !KNOWN_STYLE.has(k));
    if (unknown.length) {
      const meant = unknown.map((k) => [k, STYLE_KEYS.find((x) => fold(x) === fold(k))] as const).filter(([, m]) => m).map(([k, m]) => `${m} for ${k}`);
      add({ level: "warning", code: "unknown-style", stitchId: s.id, slot: s.slot, message: `The ${name} has ${unknown.length === 1 ? "a style" : "styles"} that nothing draws: ${unknown.join(", ")}.${meant.length ? ` Did you mean ${meant.join(", ")}?` : " Remove it, or use a style the editor offers."}` });
    }
    if (s.kind === "image" || s.kind === "video") {
      if (s.yarnId) {
        const y = o.yarn[s.yarnId];
        if (!y || y.deletedAt) { add({ level: "error", code: "missing-yarn", stitchId: s.id, slot: s.slot, message: `The ${name} uses Yarn that was deleted. Choose another file for it.` }); continue; }
        // The box in pixels at this scale, against the file's own pixels.
        const boxW = s.w * p.size.w * scale, boxH = s.h * p.size.h * scale;
        const fit = st.fit === "contain" || st.fit === "fill" ? st.fit : "cover";
        if (y.width) {
          const sx = boxW / y.width, sy = y.height ? boxH / y.height : sx;
          // How far the file is enlarged. Cover and fill stretch it to the box's longer reach; contain to its shorter.
          const up = fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
          const across = up === sx ? `${y.width}px wide but is drawn ${Math.round(boxW)}px wide` : `${y.height}px tall but is drawn ${Math.round(boxH)}px tall`;
          if (y.mime !== "image/svg+xml" && up > 1.25) add({ level: "warning", code: "low-res", stitchId: s.id, slot: s.slot, message: `The ${name} image is ${across}, so it will look soft. Use a larger file.` });
          // Cover crops whatever is not the box's shape. A box three times the picture's
          // proportions shows a third of it: a band of the picture, not the picture.
          const shown = Math.min(sx, sy) / Math.max(sx, sy);
          if (fit === "cover" && y.height && shown < 1 / 3) add({ level: "warning", code: "cropped", stitchId: s.id, slot: s.slot, message: `Only ${Math.round(shown * 100)}% of the ${name} image is in its box. The box is ${(1 / shown).toFixed(1)} times ${sx > sy ? "wider" : "taller"}, in proportion, than the image, so the rest is cut off. Use an image closer to the box's shape, change the box's shape, or set Fit to Contain.` });
        }
      } else if (s.slot && s.slot !== "backdrop") {
        add({ level: "warning", code: "empty-image-slot", stitchId: s.id, slot: s.slot, message: `The ${name} slot has no image yet, so it will be empty in the knit.` });
      }
    }
    if (s.kind === "text") {
      if (!(s.content ?? "").trim()) add({ level: "warning", code: "empty-text", stitchId: s.id, slot: s.slot, message: `The ${name} text is empty.` });
      const fg = hexOf(st.color) ?? colorFor(sw, "text");
      const ground = groundFor(p, sw, s);
      const r = ground ? ratio(fg, ground) : Infinity;
      const size = Number(st.fontSize ?? 0.05) * p.size.w;
      const large = size >= 56 || (size >= 42 && Number(st.fontWeight ?? 400) >= 700);
      const need = large ? 3 : 4.5;
      if (r < need) add({ level: "warning", code: "low-contrast", stitchId: s.id, slot: s.slot, message: `${s.slot ? `The ${s.slot} text` : `Text that says "${(s.content ?? "").replace(/\*/g, "").slice(0, 30)}"`} is ${r.toFixed(1)}:1 against what is behind it. It needs ${need}:1 to read easily. Try a different colour from your swatch.` });
    }
    if (s.x < -0.01 || s.y < -0.01 || s.x + s.w > 1.01 || s.y + s.h > 1.01) {
      if (!(s.slot === "backdrop")) add({ level: "warning", code: "off-canvas", stitchId: s.id, slot: s.slot, message: `The ${name} runs past the edge of the frame, so part of it will be cut off.` });
    }
  }
  const voiced = (p.motion?.audio ?? []).some((a) => a.kind === "voice");
  const code = codeOnScreen(p);
  for (const a of p.motion?.audio ?? []) {
    const said = a.kind === "voice" && a.label ? spokenProblem(a.label, code) : null;
    if (said) issues.push({ level: "warning", code: "voice-reads-code", message: said });
    const y = o.yarn[a.yarnId];
    if (!y || y.deletedAt) issues.push({ level: "error", code: "missing-yarn", message: `The ${a.kind === "voice" ? "voiceover" : "music"} "${a.label ?? "sound"}" uses a file that was deleted. Choose another or remove it.` });
    // Every track is levelled to the voice's loudness before mixing, so gain is how far under the
    // voice the music sits. Real reels had 0.08 (22 dB under), from older advice, and the knit
    // used to hide it by riding the gain up at the end; now it would barely be heard.
    else if (a.kind === "music" && typeof a.gain === "number" && a.gain > 0 && a.gain < 0.25) issues.push({ level: "warning", code: "quiet-music", message: `The music${a.label ? ` "${a.label}"` : ""} is at gain ${a.gain}, ${Math.round(-20 * Math.log10(a.gain))} dB under the voice level, so it will barely be heard${voiced ? " even when nobody speaks" : ""}. Every track is brought to one loudness first, so 0.4 to 0.6 suits most videos${voiced ? ", and the knit lowers the music under the voice by itself" : ""}.` });
  }
  for (const m of motionLint(p)) issues.push({ level: "warning", code: m.code, stitchId: m.stitchId, message: m.message });
  // Footage the video's rate does not divide into: some of its frames are held longer than others.
  if (p.durationMs > 0) {
    const fps = videoFps(p, o.yarn, o.fps), told = new Set<string>();
    for (const { s, y } of footageIn(p, o.yarn)) {
      const r = cleanRate(y.meta?.fps);
      if (!r || fps % r === 0 || told.has(y.id)) continue;
      told.add(y.id);
      add({ level: "warning", code: "footage-rate", stitchId: s.id, slot: s.slot, message: `The ${s.slot ?? "footage"} "${y.name}" was shot at ${y.meta.fps} frames a second and this video is ${fps}, so some of its frames are held longer than others and its motion hitches. A video is knitted at its footage's own rate when all of it shares one (24, 25 or 30)${fps === 60 ? " and 60 is not asked for" : ""}, so use footage shot at one rate${fps === 60 ? ", at the standard smoothness" : ""}.` });
    }
  }
  issues.push(...safeZoneIssues(p, sw));
  return issues;
}

/**
 * Tall 9:16 frames are stories and reels, and the apps draw over their edges: the account
 * name and progress bar over the top, the reply bar and buttons over the bottom. All 9 real
 * stories reviewed put the logo under the first and the call to action under the second.
 */
export const STORY_SAFE = { top: 0.13, bottom: 0.18 };
const isTall = (p: Pattern) => { const r = p.size.h / p.size.w; return r > 1.7 && r < 1.85; };

/** Where text actually sits, measured in the page: fractions of the frame's height. */
export interface TextExtent { stitchId: string; slot?: string; top: number; bottom: number; }

/**
 * Things the apps' bars would cover. Without a browser a text box's lines are not known, so
 * only the line it is anchored by (its first, middle or last, from verticalAlign) is counted;
 * given `measured`, the text's real extent is used instead. Small pictures and parts (a
 * logo, a badge) count by their box. Full-bleed backgrounds are meant to run under the bars.
 */
export function safeZoneIssues(p: Pattern, sw: Swatch, measured?: TextExtent[]): KnitIssue[] {
  if (!isTall(p)) return [];
  const out: KnitIssue[] = [];
  const topLine = STORY_SAFE.top, bottomLine = 1 - STORY_SAFE.bottom, slack = 0.005;
  const flag = (s: Pattern["stitches"][number], top: number, bottom: number) => {
    const what = s.kind === "text" ? (s.slot ? `${s.slot} text` : `text "${(s.content ?? "").replace(/\*/g, "").slice(0, 30)}"`) : (s.slot ?? s.kind);
    if (top < topLine - slack) out.push({ level: "warning", code: "safe-zone", stitchId: s.id, slot: s.slot, message: `The ${what} is in the top ${Math.round(topLine * 100)}% of a 9:16 frame, where Instagram and TikTok put the account name and progress bar over it. Keep it below ${Math.round(topLine * p.size.h)}px.` });
    else if (bottom > bottomLine + slack) out.push({ level: "warning", code: "safe-zone", stitchId: s.id, slot: s.slot, message: `The ${what} is in the bottom ${Math.round(STORY_SAFE.bottom * 100)}% of a 9:16 frame, where the reply bar and buttons cover it. Keep it above ${Math.round(bottomLine * p.size.h)}px.` });
  };
  const byId = new Map((measured ?? []).map((m) => [m.stitchId, m]));
  for (const s of p.stitches) {
    const st = resolveStyle(sw, s.style);
    if (st.hidden || s.slot === "backdrop") continue;
    if (s.kind === "text") {
      if (!(s.content ?? "").trim()) continue;
      const m = byId.get(s.id);
      if (m) { flag(s, m.top, m.bottom); continue; }
      const line = (Number(st.fontSize ?? 0.05) * p.size.w * Number(st.lineHeight ?? 1.05)) / p.size.h;
      const va = st.verticalAlign;
      const [a, b] = va === "bottom" ? [s.y + s.h - line, s.y + s.h] : va === "middle" ? [s.y + s.h / 2 - line / 2, s.y + s.h / 2 + line / 2] : [s.y, s.y + line];
      flag(s, a, b);
    } else if (s.kind === "image" || s.kind === "video" || s.kind === "part") {
      if (s.w * s.h > 0.25) continue;
      flag(s, s.y, s.y + s.h);
    }
  }
  return out;
}

export interface MeasuredText { stitchId: string; slot?: string; overflow: boolean; top?: number; bottom?: number; }
/** Turn the page's own measurements (does each text box fit its text?) into issues. */
export function overflowIssues(measured: MeasuredText[]): KnitIssue[] {
  return measured.filter((m) => m.overflow).map((m) => ({ level: "warning" as const, code: "text-overflow", stitchId: m.stitchId, slot: m.slot, message: `The ${m.slot ?? "text"} does not fit its box, so it spills out over what is around it, or past the edge of the frame. Shorten it, make the box bigger, or turn on "shrink to fit".` }));
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
