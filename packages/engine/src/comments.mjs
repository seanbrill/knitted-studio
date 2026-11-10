// A comment as a model looks at it: the knit (at the comment's moment, in a video) or the
// frame, with the pin drawn where the person put it, beside a close-up of that spot; and what
// is under the pin: the stitch there in the knit's pattern, or the element there in the frame.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { stillMs } from "@knitted/core";
import { getComment, getDesign, getKnit, knitPath, withPieces } from "@knitted/core/node";
import { elementAt, renderDesign } from "./design.mjs";
import { run } from "./knit.mjs";
import { openRenderer } from "./renderer.mjs";
import { stitchesAt } from "./runner.mjs";

const RED = "#d92414";
const WHOLE = 1100;
const CLOSE = 560;

/** A pin, numbered, as an SVG the size of the picture it goes on. */
function pinSvg(w, h, px, py, n, r) {
  const t = Math.round(r * 0.9);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<circle cx="${px}" cy="${py}" r="${r}" fill="none" stroke="#fff" stroke-width="${Math.max(4, r / 3)}"/>
<circle cx="${px}" cy="${py}" r="${r}" fill="none" stroke="${RED}" stroke-width="${Math.max(2, r / 6)}"/>
<circle cx="${px + r}" cy="${py - r}" r="${t}" fill="${RED}" stroke="#fff" stroke-width="2"/>
<text x="${px + r}" y="${py - r}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${Math.round(t * 1.1)}" fill="#fff" text-anchor="middle" dominant-baseline="central">${n}</text>
</svg>`);
}

/** The picture with the pin on it, and a close-up of the spot beside it, as one PNG. */
export async function withPin(png, { x, y, n }) {
  const { width: W, height: H } = await sharp(png).metadata();
  if (x == null || y == null) return sharp(png).resize({ width: WHOLE, height: WHOLE, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const px = Math.round(x * W), py = Math.round(y * H);
  const whole = await sharp(png).composite([{ input: pinSvg(W, H, px, py, n, Math.max(14, Math.round(Math.min(W, H) * 0.03))) }])
    .resize({ width: WHOLE, height: WHOLE, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  // The close-up: a square round the pin, a third of the picture's short side, kept inside it.
  const side = Math.min(W, H, Math.max(160, Math.round(Math.min(W, H) / 3)));
  const left = Math.max(0, Math.min(W - side, px - Math.round(side / 2))), top = Math.max(0, Math.min(H - side, py - Math.round(side / 2)));
  const close = await sharp(png).extract({ left, top, width: side, height: side })
    .composite([{ input: pinSvg(side, side, px - left, py - top, n, Math.max(10, Math.round(side * 0.06))) }])
    .resize({ width: CLOSE, height: CLOSE }).png().toBuffer();
  const wm = await sharp(whole).metadata();
  const gap = 24;
  return sharp({ create: { width: wm.width + gap + CLOSE, height: Math.max(wm.height, CLOSE), channels: 3, background: "#ebe6de" } })
    .composite([{ input: whole, left: 0, top: 0 }, { input: close, left: wm.width + gap, top: 0 }]).png().toBuffer();
}

/** A video's frame at a moment, as PNG. */
async function frameOf(file, timeMs) {
  const dir = await mkdtemp(join(tmpdir(), "knitted-moment-"));
  try {
    const at = join(dir, "frame.png");
    await run("ffmpeg", ["-v", "error", "-y", "-ss", (timeMs / 1000).toFixed(3), "-i", file, "-frames:v", "1", at], { timeoutMs: 60_000 });
    return await readFile(at);
  } catch { throw Object.assign(new Error("That moment of the video could not be drawn: is ffmpeg installed?"), { kind: "validation" }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

/**
 * Look at a comment: its picture with the pin, and what is under the pin.
 * A comment on a frame deleted since is shown on the whole sheet, without its pin, and says so.
 * A comment on a piece (a pattern, a part or a picture on the sheet) says which, as `piece`; on a
 * pattern, what is under the pin is its stitches, as on a knit.
 * @returns {Promise<{ thread: import("@knitted/core").CommentThread, png: Buffer | null, under: unknown, patternId: string | null, frameGone?: boolean, piece?: { kind: string, id: string, name: string } | null }>}
 */
export async function lookAtComment(store, commentId, { renderer: injected } = {}) {
  const thread = getComment(store, commentId);
  // The browser, only when it is needed: a knit's own picture is drawn without one.
  let opened = null;
  const browser = async () => injected ?? (opened ??= await openRenderer());
  try {
    if (thread.knitId) {
      const k = getKnit(store, thread.knitId);
      const file = knitPath(store, k);
      const base = k.kind === "video" ? await frameOf(file, thread.timeMs ?? 0) : await readFile(file);
      let under = null, patternId = null;
      if (k.patternId) {
        try { store.getPattern(k.patternId); patternId = k.patternId; } catch { /* the pattern is gone */ }
        if (patternId && thread.x != null && thread.y != null) {
          try { under = await stitchesAt(store, patternId, { x: thread.x, y: thread.y, timeMs: thread.timeMs ?? 0, renderer: await browser() }); } catch { /* no browser yet: the picture says enough */ }
        }
      }
      return { thread, png: await withPin(base, thread), under, patternId };
    }
    const renderer = await browser();
    const frame = thread.frameId ? withPieces(store, getDesign(store, thread.designId)).sections.flatMap((s) => s.frames).find((f) => f.id === thread.frameId) : undefined;
    const here = !!frame;
    const png = await renderDesign(store, thread.designId, { frameId: here ? thread.frameId : undefined, renderer });
    if (thread.frameId && !here) return { thread, png: await withPin(png, {}), under: null, patternId: null, frameGone: true };
    const pinned = thread.x != null && thread.y != null;
    // A pattern on the sheet: the comment is about the pattern, and what is under the pin is its stitches, drawn as the sheet shows it.
    const piece = frame?.piece && !frame.piece.gone ? { kind: frame.piece.kind, id: frame.piece.id, name: frame.name } : null;
    if (piece) {
      let under = null;
      if (piece.kind === "pattern" && pinned) {
        try { under = await stitchesAt(store, piece.id, { x: thread.x, y: thread.y, timeMs: stillMs(store.getPattern(piece.id)), renderer }); } catch { /* the picture says enough */ }
      }
      return { thread, png: await withPin(png, thread), under, patternId: piece.kind === "pattern" ? piece.id : null, piece };
    }
    const under = here && pinned ? await elementAt(store, thread.designId, thread.frameId, { x: thread.x, y: thread.y, renderer }).catch(() => null) : null;
    return { thread, png: await withPin(png, thread), under, patternId: null };
  } finally { if (opened) await opened.close(); }
}
