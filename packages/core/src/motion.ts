// Motion: clips on a timeline, compiled to plain CSS animations.
//
// WHY CSS AND NOT A RUNTIME: the engine's whole promise is that time is SET, never
// waited for. CSS animations are paused and driven by `currentTime`, so the
// editor's preview, the knit and a frame-hash test are the same thing. A bespoke
// JavaScript animator would need its own determinism story; this one is free.
//
// Transforms use the INDEPENDENT properties (`translate`, `scale`) rather than
// `transform`, so an animation composes with a stitch's own rotation instead of
// replacing it.

import type { Clip, Ease, Motion, Pattern, Preset, Stitch } from "./types.ts";

export const EASES: Record<Ease, string> = {
  linear: "linear",
  "ease-out": "cubic-bezier(0.2, 0, 0, 1)",
  "ease-in": "cubic-bezier(0.4, 0, 1, 1)",
  "ease-in-out": "cubic-bezier(0.65, 0, 0.35, 1)",
  "back-out": "cubic-bezier(0.34, 1.56, 0.64, 1)",
  "spring-soft": "cubic-bezier(0.22, 1.2, 0.36, 1)",
};

export interface PresetInfo { id: Preset; label: string; kind: "in" | "out" | "loop"; text?: boolean; image?: boolean; defaultMs: number; ease: Ease; }
export const PRESETS: PresetInfo[] = [
  { id: "fade-in", label: "Fade in", kind: "in", defaultMs: 500, ease: "ease-out" },
  { id: "fade-out", label: "Fade out", kind: "out", defaultMs: 400, ease: "ease-in" },
  { id: "slide-up", label: "Slide up", kind: "in", defaultMs: 550, ease: "ease-out" },
  { id: "slide-down", label: "Slide down", kind: "in", defaultMs: 550, ease: "ease-out" },
  { id: "slide-left", label: "Slide from right", kind: "in", defaultMs: 550, ease: "ease-out" },
  { id: "slide-right", label: "Slide from left", kind: "in", defaultMs: 550, ease: "ease-out" },
  { id: "pop", label: "Pop", kind: "in", defaultMs: 500, ease: "back-out" },
  { id: "scale-in", label: "Grow in", kind: "in", defaultMs: 500, ease: "ease-out" },
  { id: "stitch-in", label: "Stitch in", kind: "in", defaultMs: 640, ease: "linear" },
  { id: "type-on", label: "Type on", kind: "in", text: true, defaultMs: 900, ease: "linear" },
  { id: "wipe", label: "Wipe", kind: "in", defaultMs: 600, ease: "ease-in-out" },
  { id: "ken-burns", label: "Slow zoom", kind: "loop", image: true, defaultMs: 4000, ease: "linear" },
  { id: "pulse", label: "Pulse", kind: "loop", defaultMs: 1200, ease: "ease-in-out" },
];
export const presetInfo = (id: Preset) => PRESETS.find((p) => p.id === id)!;

type Frames = string;
const SLIDE = (axis: string, from: string): Frames => `from{opacity:0;translate:${axis === "x" ? `${from} 0` : `0 ${from}`}}to{opacity:1;translate:0 0}`;
const KEYFRAMES: Record<Preset, Frames> = {
  "fade-in": "from{opacity:0}to{opacity:1}",
  "fade-out": "from{opacity:1}to{opacity:0}",
  "slide-up": SLIDE("y", "60%"),
  "slide-down": SLIDE("y", "-60%"),
  "slide-left": SLIDE("x", "60%"),
  "slide-right": SLIDE("x", "-60%"),
  pop: "0%{opacity:0;scale:0.6}70%{opacity:1;scale:1.06}100%{opacity:1;scale:1}",
  "scale-in": "from{opacity:0;scale:0.8}to{opacity:1;scale:1}",
  // Revealed top to bottom in rows, like rows being knitted: the theme's signature motion.
  "stitch-in": "from{clip-path:inset(0 0 100% 0);opacity:0.4}to{clip-path:inset(0 0 0 0);opacity:1}",
  "type-on": "from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}",
  wipe: "from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}",
  "ken-burns": "from{scale:1}to{scale:1.15}",
  pulse: "0%,100%{scale:1}50%{scale:1.05}",
};

const esc = (id: string) => id.replace(/["\\]/g, "");

/** How many rows a "stitch-in" reveals in, and how many steps a "type-on" takes. */
function steps(clip: Clip, stitch: Stitch): string | null {
  if (clip.preset === "stitch-in") return `steps(${Math.max(2, Math.min(8, Math.round(clip.params?.rows ?? 5)))}, end)`;
  if (clip.preset === "type-on") return `steps(${Math.max(1, (stitch.content ?? "").replace(/\*/g, "").length)}, end)`;
  return null;
}

/**
 * The CSS for every clip in a Pattern. Each clip is one animation with a delay
 * and a duration; `both` fill means a stitch waits in its starting state before
 * its entrance and holds its end state after, with no JavaScript involved.
 */
export function compileMotion(pattern: Pick<Pattern, "stitches" | "motion">): string {
  const m = pattern.motion;
  if (!m) return "";
  const used = new Set<Preset>();
  const rules: string[] = [];
  for (const s of pattern.stitches) {
    const clips = m.tracks[s.id];
    if (!clips?.length) continue;
    const anims = clips.map((c) => {
      used.add(c.preset);
      const dur = Math.max(1, c.endMs - c.startMs);
      const timing = steps(c, s) ?? EASES[c.ease ?? presetInfo(c.preset).ease];
      const loop = c.preset === "pulse" ? Math.max(1, Math.round(dur / 600)) : 1;
      return `kn-${c.preset} ${dur}ms ${timing} ${c.startMs}ms ${loop} both`;
    });
    // The Ken Burns slow zoom acts on the picture inside the box, not the box.
    const kb = clips.some((c) => c.preset === "ken-burns");
    const target = `[data-stitch-id="${esc(s.id)}"]`;
    const box = clips.filter((c) => c.preset !== "ken-burns");
    if (box.length) rules.push(`${target}{animation:${anims.filter((_, i) => clips[i].preset !== "ken-burns").join(",")}}`);
    if (kb) rules.push(`${target} .media img{animation:${anims.filter((_, i) => clips[i].preset === "ken-burns").join(",")}}`);
    void box;
  }
  const frames = [...used].map((p) => `@keyframes kn-${p}{${KEYFRAMES[p]}}`);
  return [...frames, ...rules].join("\n");
}

/** The length of the timeline: where the last clip or sound ends. */
export function motionEnd(m: Motion | undefined, soundMs: (yarnId: string) => number = () => 0): number {
  if (!m) return 0;
  const clips = Object.values(m.tracks).flat().map((c) => c.endMs);
  const audio = (m.audio ?? []).map((a) => a.startMs + (a.loop ? 0 : soundMs(a.yarnId)));
  return Math.max(0, ...clips, ...audio);
}

/**
 * The moment one picture of the pattern shows, as its card does: once everything that
 * enters before anything leaves is in. At its start, a stitch that enters later is not
 * there yet. A pattern that is not a video is knitted at its start, so that is its moment.
 */
export function stillMs(p: Pick<Pattern, "motion" | "durationMs">): number {
  if (!p.motion || !(p.durationMs > 0)) return 0;
  const clips = Object.values(p.motion.tracks).flat();
  const firstOut = Math.min(Infinity, ...clips.filter((c) => presetInfo(c.preset).kind === "out").map((c) => c.startMs));
  return Math.max(0, ...clips.filter((c) => presetInfo(c.preset).kind === "in" && c.endMs <= firstOut).map((c) => c.endMs));
}

// ── motion judged for people who cannot judge it ──────────────────────────────
export interface MotionIssue { level: "warning"; code: string; message: string; stitchId?: string; }

const words = (s: string) => (s.replace(/\*/g, "").trim().match(/\S+/g) ?? []).length;

/**
 * "Genuinely good, not merely generated": the product checks what its user can't.
 * Each rule is a number, and each is pinned by a test that feeds it a bad case.
 */
export function motionLint(p: Pick<Pattern, "stitches" | "motion" | "durationMs">): MotionIssue[] {
  const out: MotionIssue[] = [];
  const m = p.motion; const dur = p.durationMs;
  if (!m || dur <= 0) return out;
  const clips = Object.entries(m.tracks).flatMap(([id, cs]) => cs.map((c) => ({ ...c, stitchId: id })));

  // 1. Text has to stay up long enough to read: about 3 words a second, with a floor.
  for (const s of p.stitches) {
    if (s.kind !== "text" || !(s.content ?? "").trim()) continue;
    const mine = m.tracks[s.id] ?? [];
    const enter = mine.filter((c) => presetInfo(c.preset).kind === "in").map((c) => c.endMs);
    const leave = mine.filter((c) => presetInfo(c.preset).kind === "out").map((c) => c.startMs);
    const shownFrom = enter.length ? Math.min(...enter) : 0;
    const shownTo = leave.length ? Math.max(...leave) : dur;
    const need = Math.max(1200, words(s.content!) * 330);
    if (shownTo - shownFrom < need) out.push({ level: "warning", code: "text-too-brief", stitchId: s.id, message: `The ${s.slot ?? "text"} is fully on screen for ${((shownTo - shownFrom) / 1000).toFixed(1)}s but ${words(s.content!)} words need about ${(need / 1000).toFixed(1)}s to read. Hold it longer or shorten it.` });
  }

  // 2. Too many things moving at once reads as noise.
  const edges = [...new Set(clips.flatMap((c) => [c.startMs, c.endMs]))].sort((a, b) => a - b);
  for (let i = 0; i < edges.length - 1; i++) {
    const mid = (edges[i] + edges[i + 1]) / 2;
    const n = clips.filter((c) => c.startMs <= mid && c.endMs > mid && presetInfo(c.preset).kind !== "loop").length;
    if (n > 4) { out.push({ level: "warning", code: "too-busy", message: `${n} things are moving at once around ${(mid / 1000).toFixed(1)}s. Stagger them so the eye has somewhere to go.` }); break; }
  }

  // 3. Flashing: more than three light changes in a second can trigger seizures.
  const flashes = clips.filter((c) => c.preset === "fade-in" || c.preset === "fade-out" || c.preset === "pulse").map((c) => c.startMs).sort((a, b) => a - b);
  for (let i = 0; i + 3 < flashes.length; i++) {
    if (flashes[i + 3] - flashes[i] < 1000) { out.push({ level: "warning", code: "flashing", message: "More than three fades or pulses start within a second. Flashing like that can be harmful to some viewers. Space them out." }); break; }
  }

  // 4. Dead air: nothing moving for a long stretch loses short-form viewers.
  let cursor = 0;
  for (const e of edges.filter((x) => x < dur)) { if (e - cursor > 2500) { out.push({ level: "warning", code: "dead-air", message: `Nothing moves between ${(cursor / 1000).toFixed(1)}s and ${(e / 1000).toFixed(1)}s. Short videos lose people in gaps like that.` }); break; } cursor = Math.max(cursor, e); }

  // 5. A clip that runs past the end is cut off.
  const over = clips.find((c) => c.endMs > dur + 5);
  if (over) out.push({ level: "warning", code: "past-end", stitchId: over.stitchId, message: `An animation ends at ${(over.endMs / 1000).toFixed(1)}s but the video ends at ${(dur / 1000).toFixed(1)}s, so its last part is cut off.` });

  // 6. Finishing on the last frame of motion feels abrupt.
  const lastMove = Math.max(0, ...clips.filter((c) => presetInfo(c.preset).kind !== "loop").map((c) => c.endMs));
  if (clips.length && dur - lastMove < 400) out.push({ level: "warning", code: "no-hold", message: "The last animation ends right as the video does. Hold the final frame for about half a second so it lands." });
  return out;
}
