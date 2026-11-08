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
//
// A sliding stitch is put on its own layer while it slides, by the page's seek()
// (render's stageScript), never here: see the note there.

import type { Clip, Ease, Motion, Pattern, Preset, Stitch } from "./types.ts";

export const EASES: Record<Ease, string> = {
  linear: "linear",
  // Ease-out-quad. The old curve (0.2, 0, 0, 1) peaked at 3.5 times its average speed and moved
  // under 5% in its last third, so a 500 ms slide did 73% in five frames, then sat still.
  "ease-out": "cubic-bezier(0.5, 1, 0.89, 1)",
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
  { id: "stitch-in", label: "Stitch in", kind: "in", defaultMs: 800, ease: "ease-out" },
  { id: "type-on", label: "Type on", kind: "in", text: true, defaultMs: 900, ease: "linear" },
  { id: "wipe", label: "Wipe", kind: "in", defaultMs: 600, ease: "ease-in-out" },
  { id: "ken-burns", label: "Slow zoom", kind: "loop", image: true, defaultMs: 4000, ease: "linear" },
  { id: "pulse", label: "Pulse", kind: "loop", defaultMs: 1200, ease: "ease-in-out" },
  // Ways out. Before these there was only a fade, and in 453 clips of real knits, 4 were exits:
  // a scene was just covered by the next one, and its words were still there underneath.
  { id: "slide-out-up", label: "Slide out up", kind: "out", defaultMs: 400, ease: "ease-in" },
  { id: "slide-out-down", label: "Slide out down", kind: "out", defaultMs: 400, ease: "ease-in" },
  { id: "slide-out-left", label: "Slide out left", kind: "out", defaultMs: 400, ease: "ease-in" },
  { id: "slide-out-right", label: "Slide out right", kind: "out", defaultMs: 400, ease: "ease-in" },
  { id: "shrink-out", label: "Shrink away", kind: "out", defaultMs: 400, ease: "ease-in" },
  { id: "wipe-out", label: "Wipe away", kind: "out", defaultMs: 500, ease: "ease-in-out" },
];
export const presetInfo = (id: Preset) => PRESETS.find((p) => p.id === id)!;

type Frames = string;
const SLIDE = (axis: string, from: string): Frames => `from{opacity:0;translate:${axis === "x" ? `${from} 0` : `0 ${from}`}}to{opacity:1;translate:0 0}`;
// An exit moves less than an entrance (40% of its size, not 60%): it is quicker, and the eye is
// already on what comes next.
const SLIDE_OUT = (axis: string, to: string): Frames => `from{opacity:1;translate:0 0}to{opacity:0;translate:${axis === "x" ? `${to} 0` : `0 ${to}`}}`;
const KEYFRAMES: Record<Preset, Frames> = {
  "fade-in": "from{opacity:0}to{opacity:1}",
  "fade-out": "from{opacity:1}to{opacity:0}",
  "slide-up": SLIDE("y", "60%"),
  "slide-down": SLIDE("y", "-60%"),
  "slide-left": SLIDE("x", "60%"),
  "slide-right": SLIDE("x", "-60%"),
  pop: "0%{opacity:0;scale:0.6}70%{opacity:1;scale:1.06}100%{opacity:1;scale:1}",
  "scale-in": "from{opacity:0;scale:0.8}to{opacity:1;scale:1}",
  // The theme's signature motion. On text it is played by the words (see textClip); on
  // anything else, a smooth reveal from the top.
  "stitch-in": "from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}",
  // Played by the characters themselves (see textClip): this is only its timeline mark.
  "type-on": "from{opacity:1}to{opacity:1}",
  wipe: "from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}",
  "ken-burns": "from{scale:1}to{scale:1.15}",
  pulse: "0%,100%{scale:1}50%{scale:1.05}",
  "slide-out-up": SLIDE_OUT("y", "-40%"),
  "slide-out-down": SLIDE_OUT("y", "40%"),
  "slide-out-left": SLIDE_OUT("x", "-40%"),
  "slide-out-right": SLIDE_OUT("x", "40%"),
  "shrink-out": "from{opacity:1;scale:1}to{opacity:0;scale:0.85}",
  // Carries on the way the wipe in went: in from the left edge, away towards the right.
  "wipe-out": "from{clip-path:inset(0 0 0 0)}to{clip-path:inset(0 0 0 100%)}",
};

const esc = (id: string) => id.replace(/["\\]/g, "");

// TEXT PLAYED BY ITS OWN PIECES. Type-on used to sweep a clip across the whole box in steps:
// two or three characters a step, letters cut in half, and both lines of wrapped text typed at
// once. Stitch-in revealed in five hard rows that sliced through letters. Now the renderer puts
// each character (type-on) or word (stitch-in) in its own span, shown at its own moment: it
// types a letter at a time in reading order, line by line, and nothing reflows, because a
// piece not yet shown still holds its place.

/** The type-on or stitch-in clip a text stitch's own words play, if it has one. */
export function textClip(stitch: Pick<Stitch, "id" | "kind">, motion: Motion | undefined): Clip | null {
  if (stitch.kind !== "text") return null;
  return (motion?.tracks[stitch.id] ?? []).find((c) => c.preset === "type-on" || c.preset === "stitch-in") ?? null;
}
/** How long one word of a stitch-in takes to rise into place. */
export const wordMs = (clip: Clip) => Math.round(Math.min(450, Math.max(1, clip.endMs - clip.startMs) * 0.6));
/**
 * When each of `count` pieces shows, in ms on the pattern's clock. Characters come evenly
 * through the clip, the last one at its end; words start evenly so the last one lands at the end.
 */
export function pieceTimes(clip: Clip, count: number): number[] {
  const dur = Math.max(1, clip.endMs - clip.startMs);
  if (count <= 0) return [];
  if (clip.preset === "type-on") return Array.from({ length: count }, (_, i) => Math.round(clip.startMs + ((i + 1) * dur) / count) - 1);
  const span = Math.max(0, dur - wordMs(clip));
  return Array.from({ length: count }, (_, i) => Math.round(clip.startMs + (count === 1 ? 0 : (i * span) / (count - 1))));
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
  let chars = false, rise = false;
  for (const s of pattern.stitches) {
    // In time order: of two animations on one property, the later in the list wins.
    const clips = [...(m.tracks[s.id] ?? [])].sort((a, b) => a.startMs - b.startMs);
    if (!clips.length) continue;
    const words = textClip(s, m);
    const css = (list: Clip[]) => list.map((c, i) => {
      used.add(c.preset);
      const dur = Math.max(1, c.endMs - c.startMs);
      const timing = EASES[c.ease ?? presetInfo(c.preset).ease];
      // A pulse beats about every 600 ms, all inside its clip.
      const loop = c.preset === "pulse" ? Math.max(1, Math.round(dur / 600)) : 1;
      // Only the first clip waits in its starting state. With `both` on every clip, a later
      // one held ITS start from frame 0 and overrode the first: an exit's fade-out showed the
      // stitch at full opacity before its fade-in, a pulse after a pop wiped out the pop.
      return `kn-${c.preset} ${Math.max(1, Math.round(dur / loop))}ms ${timing} ${c.startMs}ms ${loop} ${i === 0 ? "both" : "forwards"}`;
    }).join(",");
    const target = `[data-stitch-id="${esc(s.id)}"]`;
    // The Ken Burns slow zoom acts on the picture inside the box, not the box; on footage too.
    const kb = clips.filter((c) => c.preset === "ken-burns");
    const box = clips.filter((c) => c.preset !== "ken-burns" && c !== words);
    if (box.length) rules.push(`${target}{animation:${css(box)}}`);
    if (kb.length) rules.push(`${target} .media img,${target} .media video{animation:${css(kb)}}`);
    // Each piece's own moment is its animation-delay, written on it by the renderer.
    if (words?.preset === "type-on") { used.add("type-on"); chars = true; rules.push(`${target} .kc{animation:kn-char 1ms linear 0ms 1 both}`); }
    if (words?.preset === "stitch-in") { used.add("stitch-in"); rise = true; rules.push(`${target} .kw{display:inline-block;animation:kn-word ${wordMs(words)}ms ${EASES[words.ease ?? "ease-out"]} 0ms 1 both}`); }
  }
  if (chars) rules.unshift("@keyframes kn-char{from{opacity:0}to{opacity:1}}");
  if (rise) rules.unshift("@keyframes kn-word{from{opacity:0;translate:0 0.4em}to{opacity:1;translate:0 0}}");
  const frames = [...used].map((p) => `@keyframes kn-${p}{${KEYFRAMES[p]}}`);
  return [...frames, ...rules].join("\n");
}

/** The length of the timeline: where the last clip or sound ends. */
export function motionEnd(m: Motion | undefined, soundMs: (yarnId: string) => number = () => 0): number {
  if (!m) return 0;
  const clips = Object.values(m.tracks).flat().map((c) => c.endMs);
  const audio = (m.audio ?? []).map((a) => a.startMs + (a.loop ? 0 : Math.max(0, soundMs(a.yarnId) - (a.fromMs ?? 0))));
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

/**
 * When a stitch is on screen, by its clips: it starts coming in at `from` and is all there at
 * `inAt`; it starts going at `outAt` and is gone at `goneAt`. Only a first clip that is an
 * entrance keeps it off screen before it (compileMotion's fill rule); with none, it is there
 * from the start, and with no exit, until the end.
 */
export interface Shown { from: number; inAt: number; outAt: number; goneAt: number; }
export function shownOf(stitchId: string, m: Motion | undefined, durationMs: number): Shown {
  // The slow zoom plays on the picture inside the box, so it says nothing about the box.
  const clips = (m?.tracks[stitchId] ?? []).filter((c) => c.preset !== "ken-burns").sort((a, b) => a.startMs - b.startMs);
  const enter = clips[0] && presetInfo(clips[0].preset).kind === "in" ? clips[0] : undefined;
  const from = enter?.startMs ?? 0;
  const exit = clips.find((c) => presetInfo(c.preset).kind === "out" && c.startMs >= from);
  return { from, inAt: enter?.endMs ?? 0, outAt: exit?.startMs ?? durationMs, goneAt: exit?.endMs ?? durationMs };
}
/** When a stitch starts coming in: footage starts playing from its first frame then, not at 0. */
export const entersAt = (stitchId: string, m: Motion | undefined) => shownOf(stitchId, m, Infinity).from;

// ── scene changes ──────────────────────────────────────────────────────────────
export interface SceneChange {
  atMs: number;
  /** Stitch ids that go out together, all gone by atMs. */
  leaving?: string[];
  /** Stitch ids that come in together, from atMs. */
  entering?: string[];
  out?: Preset;
  in?: Preset;
  /** How far apart, in ms, each one starts after the one before. */
  staggerMs?: number;
}
/**
 * The clips for one scene giving way to the next: what leaves goes out a little apart, the
 * last gone at `atMs`; what enters comes in from `atMs`, a little apart, in reading order
 * (top to bottom, then left to right), so the headline leads. A stitch's earlier exit, or
 * entrance, is replaced; its other clips stay. Returns each changed stitch's whole track.
 */
export function sceneChange(p: Pick<Pattern, "stitches" | "motion">, c: SceneChange): { stitchId: string; clips: Clip[] }[] {
  const byId = new Map(p.stitches.map((s) => [s.id, s]));
  const reading = (ids: string[] = []) => ids.map((id) => byId.get(id)).filter((s): s is Stitch => !!s).sort((a, b) => (Math.abs(a.y - b.y) > 0.02 ? a.y - b.y : a.x - b.x));
  const out = c.out && presetInfo(c.out)?.kind === "out" ? c.out : "fade-out";
  const inn = c.in && presetInfo(c.in)?.kind === "in" ? c.in : "fade-in";
  const at = Math.max(0, Math.round(c.atMs));
  const rid = (s: Stitch, k: string) => `cl_${k}${Date.now().toString(36)}${s.id.slice(-4)}`;
  const tracks = new Map<string, Clip[]>();
  const track = (id: string) => tracks.get(id) ?? [...(p.motion?.tracks[id] ?? [])];
  const leaving = reading(c.leaving), entering = reading(c.entering);
  const outMs = presetInfo(out).defaultMs, gapOut = c.staggerMs ?? 80;
  leaving.forEach((s, i) => {
    const end = at - (leaving.length - 1 - i) * gapOut, start = Math.max(0, end - outMs);
    const from = shownOf(s.id, p.motion, Infinity).from;
    const kept = track(s.id).filter((x) => !(presetInfo(x.preset).kind === "out" && x.startMs >= from));
    tracks.set(s.id, [...kept, { id: rid(s, "o"), preset: out, startMs: start, endMs: Math.max(start + 1, end), ease: presetInfo(out).ease }]);
  });
  const gapIn = c.staggerMs ?? 150;
  entering.forEach((s, i) => {
    // Type-on is only for text and a slow zoom only for pictures: anything else fades in.
    const own = presetInfo(inn).text && s.kind !== "text" ? "fade-in" : inn;
    const start = at + i * gapIn;
    const cur = track(s.id).sort((a, b) => a.startMs - b.startMs);
    const first = cur.find((x) => x.preset !== "ken-burns");
    const kept = first && presetInfo(first.preset).kind === "in" ? cur.filter((x) => x !== first) : cur;
    tracks.set(s.id, [{ id: rid(s, "i"), preset: own, startMs: start, endMs: start + presetInfo(own).defaultMs, ease: presetInfo(own).ease }, ...kept.filter((x) => x.startMs >= start || presetInfo(x.preset).kind === "loop")]);
  });
  return [...tracks].map(([stitchId, clips]) => ({ stitchId, clips }));
}

// ── motion judged for people who cannot judge it ──────────────────────────────
export interface MotionIssue { level: "warning"; code: string; message: string; stitchId?: string; }

const words = (s: string) => (s.replace(/\*/g, "").trim().match(/\S+/g) ?? []).length;
type Box = Pick<Stitch, "x" | "y" | "w" | "h">;
const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const shownStitch = (s: Stitch) => !s.style?.hidden && Number(s.style?.opacity ?? 1) > 0.05;
/** Something you cannot see through: a picture, footage, or a filled shape. */
const solid = (s: Stitch) => shownStitch(s) && Number(s.style?.opacity ?? 1) >= 0.6 && ((s.kind === "image" || s.kind === "video") ? s.style?.fit !== "contain" : s.kind === "shape" && s.style?.background !== "transparent" && s.style?.shape !== "chevrons");
/** What a person calls a stitch: its slot, its first words, or where it sits. */
const nameOf = (s: Stitch) => {
  if (s.slot) return s.slot;
  if (s.kind === "text") return `"${(s.content ?? "").replace(/\*/g, "").trim().split(/\s+/).slice(0, 3).join(" ")}"`;
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2, third = (v: number, a: string, b: string, c: string) => (v < 1 / 3 ? a : v > 2 / 3 ? c : b);
  const v = third(cy, "top", "", "bottom"), h = third(cx, "left", "", "right");
  return `${s.kind} at the ${`${v} ${h}`.trim() || "centre"}`;
};
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * When text is covered by something solid that comes in over it, above it in the stack,
 * while it is still there: the moment it can no longer be read, by stitch id.
 */
function coveredAt(p: Pick<Pattern, "stitches" | "motion" | "durationMs">): Map<string, { at: number; by: Stitch }> {
  const out = new Map<string, { at: number; by: Stitch }>();
  p.stitches.forEach((t, i) => {
    if (t.kind !== "text" || !shownStitch(t) || !(t.content ?? "").trim() || area(t) <= 0) return;
    const st = shownOf(t.id, p.motion, p.durationMs);
    for (const c of p.stitches.slice(i + 1)) {
      if (!solid(c) || overlap(t, c) < 0.5 * area(t)) continue;
      const sc = shownOf(c.id, p.motion, p.durationMs);
      if (sc.from <= st.from || sc.inAt >= st.outAt) continue;
      if (!out.has(t.id) || sc.inAt < out.get(t.id)!.at) out.set(t.id, { at: sc.inAt, by: c });
    }
  });
  return out;
}

/**
 * "Genuinely good, not merely generated": the product checks what its user can't.
 * Each rule is a number, and each is pinned by a test that feeds it a bad case.
 */
export function motionLint(p: Pick<Pattern, "stitches" | "motion" | "durationMs">): MotionIssue[] {
  const out: MotionIssue[] = [];
  const m = p.motion; const dur = p.durationMs;
  if (!m || dur <= 0) return out;
  const clips = Object.entries(m.tracks).flatMap(([id, cs]) => cs.map((c) => ({ ...c, stitchId: id })));

  // 1. Text has to stay up long enough to read: about 3 words a second, with a floor. Text
  // something solid comes in over is gone from then, though it never left: 48 of 273 real
  // texts were up too briefly that way, and this rule used to count them as on screen.
  const covered = coveredAt(p);
  for (const s of p.stitches) {
    if (s.kind !== "text" || !(s.content ?? "").trim()) continue;
    const mine = m.tracks[s.id] ?? [];
    const enter = mine.filter((c) => presetInfo(c.preset).kind === "in").map((c) => c.endMs);
    const leave = mine.filter((c) => presetInfo(c.preset).kind === "out").map((c) => c.startMs);
    const shownFrom = enter.length ? Math.min(...enter) : 0;
    const shownTo = Math.min(leave.length ? Math.max(...leave) : dur, covered.get(s.id)?.at ?? Infinity);
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

  // 4. Dead air: nothing moving for a long stretch loses short-form viewers. Every gap, and the
  // end too (most reviewed reels froze for their last 3 to 4 s). A slow zoom running through a
  // gap fills it; a pulse does not, since 5% on a button keeps the button alive, not the viewer.
  const moving = clips.filter((c) => c.preset !== "pulse").map((c) => [Math.max(0, c.startMs), Math.min(dur, c.endMs)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  if (moving.length) {
    let cursor = 0, gaps = 0;
    const s1 = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
    for (const [a, b] of moving) {
      if (a - cursor > 2500 && gaps++ < 3) out.push({ level: "warning", code: "dead-air", message: `Nothing moves between ${s1(cursor)} and ${s1(a)}. Short videos lose people in gaps like that.` });
      cursor = Math.max(cursor, b);
    }
    if (dur - cursor > 3000) out.push({ level: "warning", code: "dead-air", message: `Nothing moves for the last ${s1(dur - cursor)}, from ${s1(cursor)}. Hold the end about a second, or keep something going: a slow zoom on the picture, or the call to action coming in later.` });
  }

  // 5. A clip that runs past the end is cut off.
  const over = clips.find((c) => c.endMs > dur + 5);
  if (over) out.push({ level: "warning", code: "past-end", stitchId: over.stitchId, message: `An animation ends at ${(over.endMs / 1000).toFixed(1)}s but the video ends at ${(dur / 1000).toFixed(1)}s, so its last part is cut off.` });

  // 6. Finishing on the last frame of motion feels abrupt.
  const lastMove = Math.max(0, ...clips.filter((c) => presetInfo(c.preset).kind !== "loop").map((c) => c.endMs));
  if (clips.length && dur - lastMove < 400) out.push({ level: "warning", code: "no-hold", message: "The last animation ends right as the video does. Hold the final frame for about half a second so it lands." });

  // 7. Too fast to see. An entrance under 300 ms is under nine frames at 30 a second and reads as
  // a jump; type-on faster than 40 ms a letter lands letters in clumps (real knits had 26 ms).
  // Quick entrances are told once for the whole pattern: thirteen copies of one warning are noise.
  const byId = new Map(p.stitches.map((s) => [s.id, s]));
  const quick: { id: string; name: string; ms: number }[] = [];
  for (const c of clips) {
    const s = byId.get(c.stitchId), ms = c.endMs - c.startMs, name = s?.slot ?? s?.kind ?? "stitch";
    if (presetInfo(c.preset).kind !== "in") continue;
    if (c.preset === "type-on") {
      const n = Array.from((s?.content ?? "").replace(/\*/g, "")).length;
      if (n && ms / n < 40) out.push({ level: "warning", code: "too-fast", stitchId: c.stitchId, message: `The ${name} types ${n} characters in ${ms} ms, ${Math.round(ms / n)} ms each, so letters land in clumps. Give it ${n * 40} ms or more, or shorten the line.` });
    } else if (c.preset !== "stitch-in" && ms < 300 && !quick.some((q) => q.id === c.stitchId)) quick.push({ id: c.stitchId, name, ms });
  }
  if (quick.length) {
    const fastest = Math.min(...quick.map((q) => q.ms)), names = [...new Set(quick.map((q) => q.name))];
    out.push({ level: "warning", code: "too-fast", stitchId: quick[0].id, message: `${quick.length === 1 ? `The ${names[0]} takes ${fastest} ms to come in` : `${quick.length} things take as little as ${fastest} ms to come in (${names.slice(0, 4).join(", ")}${names.length > 4 ? ", ..." : ""})`}: ${Math.round((fastest * 30) / 1000)} frames, which reads as a jump. Give entrances 450 to 700 ms.` });
  }

  // 8. A scene covered instead of changed: the next one comes in over words that are still
  // there. They can show at its edges or through it, and the cut reads as a pile-up.
  // Told once for each thing that comes in over them: a scene's words go together.
  const changes = new Map<string, { at: number; by: Stitch; ids: string[] }>();
  for (const [id, c] of covered) {
    const k = `${c.by.id}@${c.at}`;
    changes.set(k, { ...c, ids: [...(changes.get(k)?.ids ?? []), id] });
  }
  for (const { at, by, ids } of changes.values()) {
    const names = ids.map((id) => nameOf(byId.get(id)!)), one = names.length === 1;
    const list = one ? `The ${names[0]} is` : `${names.length > 4 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`} are`;
    out.push({ level: "warning", code: "covered", stitchId: ids[0], message: `${list} still on screen at ${sec(at)} when the ${nameOf(by)} comes in over ${one ? "it" : "them"}. Take ${one ? "it" : "them"} out first, with exits that end by ${sec(at)} (fade-out, a slide out or shrink-out), so one scene gives way to the next.` });
  }

  // 9. A part before its container: dots floating on a blank page before the terminal they sit
  // in, a button empty for 4 s before its words, a label left behind when its pill goes. Each
  // stitch's container is the smallest solid thing under it that holds it; a backdrop (most of
  // the frame) holds everything, so it is no one's container.
  const kids = new Map<string, Stitch[]>();
  p.stitches.forEach((b, i) => {
    if (!shownStitch(b) || area(b) <= 0) return;
    const holders = p.stitches.slice(0, i).filter((a) => (solid(a) || a.kind === "part") && area(a) <= 0.8 && area(b) < 0.9 * area(a) && overlap(a, b) >= 0.85 * area(b));
    const a = holders.sort((x, y) => area(x) - area(y))[0];
    if (a) kids.set(a.id, [...(kids.get(a.id) ?? []), b]);
  });
  for (const [aid, list] of kids) {
    const a = byId.get(aid)!, sa = shownOf(aid, m, dur);
    const early = list.find((b) => shownOf(b.id, m, dur).from + 100 < sa.from);
    if (early) { out.push({ level: "warning", code: "before-container", stitchId: early.id, message: `The ${nameOf(early)} shows at ${sec(shownOf(early.id, m, dur).from)}, before the ${nameOf(a)} it sits on comes in at ${sec(sa.from)}, so it floats on the page. Bring it in with the ${nameOf(a)}, or just after.` }); continue; }
    const first = Math.min(...list.map((b) => shownOf(b.id, m, dur).from));
    const text = list.find((b) => b.kind === "text");
    if (text && first - sa.inAt > 1500) { out.push({ level: "warning", code: "empty-container", stitchId: aid, message: `The ${nameOf(a)} is empty from ${sec(sa.inAt)} until ${sec(first)}, when what is in it comes in. Bring its ${nameOf(text)} in with it, a beat after at most.` }); continue; }
    const left = sa.outAt < dur ? list.find((b) => shownOf(b.id, m, dur).goneAt > sa.goneAt + 100) : undefined;
    if (left) out.push({ level: "warning", code: "left-behind", stitchId: left.id, message: `The ${nameOf(left)} is still there after the ${nameOf(a)} it sits on has gone, at ${sec(sa.goneAt)}. Take it out with the ${nameOf(a)}.` });
  }
  return out;
}
