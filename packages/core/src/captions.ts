// Captions from a voiceover: text stitches timed to what is being said, plus an
// .srt file for platforms that take their own. Pure, so the editor, a model and
// the export all agree.

import type { Command } from "./commands.ts";
import type { Stitch } from "./types.ts";

export interface SpokenLine { text: string; startMs: number; endMs: number; }

const rid = () => `st_${Math.random().toString(36).slice(2, 9)}`;
const clipId = () => `cl_${Math.random().toString(36).slice(2, 8)}`;

/** One caption per line: it fades in as the line begins and out as it ends, in the lower part of the frame. */
export function captionCommands(lines: SpokenLine[], existingSlots: Iterable<string | undefined>): Command[] {
  const taken = new Set(existingSlots);
  const out: Command[] = [];
  lines.forEach((l, i) => {
    let n = i + 1; while (taken.has(`caption_${n}`)) n++;
    const slot = `caption_${n}`; taken.add(slot);
    const stitch: Stitch = {
      id: rid(), kind: "text", slot, x: 0.08, y: 0.76, w: 0.84, h: 0.12, locked: false, content: l.text,
      style: { fontFamily: "$font.body", fontSize: 0.05, fontWeight: 700, color: "$color.text", textAlign: "center", verticalAlign: "middle", lineHeight: 1.15, letterSpacing: -0.01, fit: "shrink" },
    };
    const inMs = Math.min(180, Math.max(60, (l.endMs - l.startMs) / 6));
    out.push({ type: "addStitch", stitch });
    out.push({ type: "setMotion", stitchId: stitch.id, clips: [
      { id: clipId(), preset: "fade-in", startMs: l.startMs, endMs: l.startMs + inMs, ease: "ease-out" },
      { id: clipId(), preset: "fade-out", startMs: Math.max(l.startMs + inMs, l.endMs - inMs), endMs: l.endMs, ease: "ease-in" },
    ] });
  });
  return out;
}

const ts = (ms: number) => {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), x = Math.round(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(x).padStart(3, "0")}`;
};
/** SubRip: the format every platform understands. */
export function toSrt(lines: SpokenLine[]): string {
  return lines.map((l, i) => `${i + 1}\n${ts(l.startMs)} --> ${ts(l.endMs)}\n${l.text.trim()}\n`).join("\n");
}
