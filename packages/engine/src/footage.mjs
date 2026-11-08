// Footage, made ready to knit.
//
// A knit seeks its footage to every frame. Camera files are built to be PLAYED: a whole frame
// every second or more, and the frames between are changes, so each seek decodes from the last
// whole frame. At 4K that is 200 to 500 ms a frame (a real knit drew about one frame a second),
// and the frame is then shrunk to the box anyway. So before drawing, each piece of footage is
// copied once at the size and framing it is drawn at, with a whole frame every few frames, and
// the knit plays the copy: about 60 ms a seek. The copy is kept in the cache and used again.
//
// The copy shows the same picture: it is cut to the box the way the box would crop it (cover,
// with its focus point), a little bigger under a slow zoom, never bigger than the file, and
// only what the pattern plays of it. Footage the copy could get wrong is left as it is: HDR,
// 10-bit, or anything ffprobe cannot read.

import { createHash } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { presetInfo, resolveStyle, shownOf } from "@knitted/core";
import { run } from "./knit.mjs";

/** Bump when a copy made before would come out different now. */
export const PROXY_VERSION = 1;
const PLAIN = new Set(["yuv420p", "yuvj420p", "nv12", "yuv422p", "yuvj422p", "yuv444p", "yuvj444p"]);
const HDR = new Set(["smpte2084", "arib-std-b67"]);

/** What ffprobe says about a video file, with the frame as it is shown (a phone's rotation applied). */
export async function probeFootage(file) {
  const { out } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,pix_fmt,color_space,color_transfer,color_primaries,color_range:stream_side_data=rotation:format=duration", "-of", "json", file]);
  const j = JSON.parse(out ?? "{}"), v = j.streams?.[0];
  if (!v) return null;
  const rotation = Math.abs(Number(v.side_data_list?.find((d) => d.rotation != null)?.rotation ?? 0)) % 180;
  const turned = rotation === 90;
  return {
    codec: v.codec_name, pixFmt: v.pix_fmt, width: Number(turned ? v.height : v.width), height: Number(turned ? v.width : v.height),
    durationMs: Math.round(Number(j.format?.duration) * 1000) || 0,
    colorSpace: v.color_space, transfer: v.color_transfer, primaries: v.color_primaries, range: v.color_range,
  };
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/**
 * The copy to make for footage drawn in a `box` (device pixels): the part of the frame the box
 * shows, and the size to make it. Null when the file is fine as it is. Pure, for the tests.
 * @param {{width:number,height:number,durationMs:number}} src
 * @param {{w:number,h:number}} box
 * @param {{fit?:string, focalX?:number, focalY?:number, zoom?:number, fromMs?:number, playMs?:number}} o
 */
export function proxyPlan(src, box, { fit = "cover", focalX = 0.5, focalY = 0.5, zoom = 1, fromMs = 0, playMs = Infinity } = {}) {
  if (!(src?.width > 0 && src?.height > 0 && box.w > 0 && box.h > 0)) return null;
  let crop = { x: 0, y: 0, w: src.width, h: src.height };
  // Cover crops the frame to the box's shape, the focus point kept where object-position puts it.
  if (fit !== "contain" && fit !== "fill") {
    const want = box.w / box.h, has = src.width / src.height;
    if (has > want * 1.005) { const w = even(src.height * want); crop = { x: Math.round((src.width - w) * clamp01(focalX)), y: 0, w, h: src.height }; }
    else if (has < want / 1.005) { const h = even(src.width / want); crop = { x: 0, y: Math.round((src.height - h) * clamp01(focalY)), w: src.width, h }; }
  }
  const fitScale = fit === "contain" ? Math.min(box.w / crop.w, box.h / crop.h) : Math.max(box.w / crop.w, box.h / crop.h);
  const s = Math.min(1, fitScale * Math.max(1, zoom));
  const out = { w: even(crop.w * s), h: even(crop.h * s) };
  // Only what is played: from the in-point, for as long as the pattern shows it, and a second
  // more. Footage that loops (the pattern outlasts what is left of it) is copied whole, so it
  // loops back to its own start as it always did.
  const left = src.durationMs > 0 ? src.durationMs - fromMs : Infinity;
  const trim = Number.isFinite(playMs) && playMs + 1000 < left ? { startMs: Math.max(0, fromMs), lengthMs: Math.round(playMs + 1000) } : { startMs: 0, lengthMs: null };
  return { crop, out, trim };
}
const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(+v) ? +v : 0.5));

/** Chromium's guess for footage with no colour tags: BT.709 from 720 lines up, BT.601 below. Kept, so the copy shows the same colours. */
const matrixOf = (p) => p.colorSpace && p.colorSpace !== "unknown" ? p.colorSpace : p.height >= 720 ? "bt709" : "smpte170m";

/** Make (or find) the copy for one plan. Returns its path, or null if the footage is better left as it is. */
export async function makeProxy(cacheDir, file, probe, plan) {
  if (!probe || !PLAIN.has(probe.pixFmt) || HDR.has(probe.transfer)) return null;
  const { size, mtimeMs } = await stat(file);
  const key = createHash("sha256").update(JSON.stringify({ v: PROXY_VERSION, file, size, mtimeMs, plan })).digest("hex").slice(0, 20);
  const dir = join(cacheDir, "footage");
  const out = join(dir, `${key}.mp4`);
  if (await stat(out).then((s) => s.size > 0, () => false)) return out;
  await mkdir(dir, { recursive: true });
  const { crop, out: o, trim } = plan;
  const vf = [crop.w !== probe.width || crop.h !== probe.height ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}` : null, `scale=${o.w}:${o.h}:flags=lanczos`, "format=yuv420p"].filter(Boolean).join(",");
  const tmp = `${out}.${process.pid}.part.mp4`;
  const tags = ["-colorspace", matrixOf(probe), ...(probe.primaries && probe.primaries !== "unknown" ? ["-color_primaries", probe.primaries] : []), ...(probe.transfer && probe.transfer !== "unknown" ? ["-color_trc", probe.transfer] : []), "-color_range", "tv"];
  try {
    await run("ffmpeg", ["-v", "error", "-y", ...(trim.startMs ? ["-ss", (trim.startMs / 1000).toFixed(3)] : []), "-i", file, ...(trim.lengthMs ? ["-t", (trim.lengthMs / 1000).toFixed(3)] : []),
      "-an", "-sn", "-dn", "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-g", "8", "-bf", "0", "-fps_mode", "passthrough", ...tags, "-movflags", "+faststart", tmp]);
    await rename(tmp, out);
    return out;
  } catch {
    await rm(tmp, { force: true });
    return null;
  }
}

/**
 * For each footage stitch in a pattern knitted as a video, the copy to play and where in it the
 * pattern's in-point now is. Anything that cannot be copied plays the original, as before.
 * @returns {Promise<Map<string, {url: string, offsetMs: number}>>}
 */
export async function prepareFootage({ cacheDir, pattern, swatch, yarnFile, scale = 1, onStep }) {
  const found = new Map();
  const videos = (pattern.stitches ?? []).filter((s) => s.kind === "video" && s.yarnId && yarnFile(s.yarnId));
  for (const s of videos) {
    const file = yarnFile(s.yarnId);
    const st = resolveStyle(swatch, s.style);
    if (st.hidden) continue;
    onStep?.();
    const probe = await probeFootage(file).catch(() => null);
    if (!probe) continue;
    const shown = shownOf(s.id, pattern.motion, pattern.durationMs);
    const zoom = (pattern.motion?.tracks[s.id] ?? []).some((c) => c.preset === "ken-burns") ? 1.15 : (pattern.motion?.tracks[s.id] ?? []).some((c) => ["pop", "pulse"].includes(c.preset) || presetInfo(c.preset).kind === "loop") ? 1.06 : 1;
    const fromMs = Math.max(0, Math.round(Number(st.fromMs) || 0));
    const box = { w: s.w * pattern.size.w * scale, h: s.h * pattern.size.h * scale };
    const plan = proxyPlan(probe, box, { fit: st.fit, focalX: st.focalX, focalY: st.focalY, zoom, fromMs, playMs: Math.max(0, pattern.durationMs - shown.from) });
    if (!plan) continue;
    const proxy = await makeProxy(cacheDir, file, probe, plan);
    if (proxy) found.set(s.id, { url: pathToFileURL(proxy).href, offsetMs: plan.trim.startMs });
  }
  return found;
}
