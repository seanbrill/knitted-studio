// Knit: turn Patterns into files.
//
// One function does the whole job, whether it was asked for by the Knit button,
// a batch from a spreadsheet, the CLI or a model: for every (row x size) unit,
// check it, draw it, verify the file, record it, and report real progress.
//
// Determinism is the engine's contract (see knit.mjs): animations are paused and
// time is SET, never waited for, so two knits of the same inputs are the same
// bytes. The hash below is how we know "the same inputs".

import { createHash } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { applyCommand, hasErrors, overflowIssues, postflight, preflight, resolveStyle, SIZES } from "@knitted/core";
import { activeSwatch, findKnitByHash, getPart, insertKnit, knitPath, listYarn } from "@knitted/core/node";
import { fontFaceCss, fontPath } from "@knitted/fonts";
import { familiesUsed, pageFor } from "@knitted/render";
import { FPS, frameTimes, run } from "./knit.mjs";
import { openRenderer } from "./renderer.mjs";
import { measureLoudness, mixAudio, muxAudio, videoHash } from "./audio.mjs";

/** Bump when a change to rendering could change output bytes. It is part of every knit's hash. */
export const ENGINE_VERSION = "1";

export class Cancelled extends Error { constructor() { super("Knit cancelled."); this.kind = "cancelled"; } }

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "knit";
const sha = (o) => createHash("sha256").update(typeof o === "string" ? o : JSON.stringify(o)).digest("hex");
const FORMATS = { png: "png", jpeg: "jpg", jpg: "jpg", webp: "webp", mp4: "mp4" };

/**
 * Apply one batch row to a Pattern as someone using it (never as the brand
 * owner), so a row cannot write to a locked slot. A row value for a text slot is
 * the text; for an image slot it is a Yarn name, or `tag:product` to pick from a
 * tag, taking turns across rows.
 */
export function applyRow(pattern, row, yarn, rowIndex) {
  let p = pattern;
  const problems = [];
  for (const [slot, raw] of Object.entries(row ?? {})) {
    const value = String(raw ?? "");
    const s = p.stitches.find((x) => x.slot === slot);
    if (!s) { problems.push({ level: "warning", code: "no-such-slot", slot, message: `This pattern has no slot called "${slot}", so that column was ignored.` }); continue; }
    let cmd;
    if (s.kind === "text") cmd = { type: "fillSlot", slot, content: value };
    else if (s.kind === "image" || s.kind === "video") {
      const pool = value.startsWith("tag:") ? yarn.filter((y) => y.tags.includes(value.slice(4).trim().toLowerCase()) && (y.kind === "image" || y.kind === "video")) : yarn.filter((y) => y.name.toLowerCase() === value.trim().toLowerCase());
      const pick = pool.length ? pool[rowIndex % pool.length] : null;
      if (!pick) { problems.push({ level: "error", code: "yarn-not-found", slot, message: `No Yarn matches "${value}" for ${slot}. Check the name, or add a tag to your files.` }); continue; }
      cmd = { type: "updateStitch", id: s.id, patch: { yarnId: pick.id } };
    } else continue;
    const r = applyCommand(p, cmd, "fill");
    for (const ref of r.refusals) problems.push({ level: "error", code: "locked-slot", slot, message: `${slot}: ${ref.why}.` });
    if (r.changed) p = r.pattern;
  }
  return { pattern: p, problems };
}

function unitsFor(pattern, params, yarn) {
  const rows = params.rows?.length ? params.rows : [null];
  const sizes = params.sizes?.length ? params.sizes : [pattern.size];
  const units = [];
  rows.forEach((row, ri) => {
    sizes.forEach((size) => {
      const { pattern: filled, problems } = applyRow(pattern, row, yarn, ri);
      const sized = size.w === pattern.size.w && size.h === pattern.size.h ? filled : applyCommand(filled, { type: "setSize", size }, "human").pattern;
      const headline = row ? (row.headline ?? Object.values(row)[0]) : "";
      units.push({ row, rowIndex: ri, size, pattern: sized, problems, label: [pattern.name, size.name, row ? `#${ri + 1} ${String(headline ?? "").slice(0, 24)}` : ""].filter(Boolean).join(" · ") });
    });
  });
  return units;
}

/** Everything that can change the bytes, hashed. */
function hashFor(store, unit, swatch, yarnMap, format, scale) {
  const used = unit.pattern.stitches.map((s) => s.yarnId).filter(Boolean).sort().map((id) => [id, yarnMap[id]?.hash]);
  const { id, version, updatedAt, projectId, ...pat } = unit.pattern; void id; void version; void updatedAt; void projectId;
  const parts = unit.pattern.stitches.filter((s) => s.partId).map((s) => { try { const p = getPart(store, s.partId); return [p.id, p.version]; } catch { return [s.partId, null]; } });
  return sha({ engine: ENGINE_VERSION, pat, sw: { c: swatch.colors, f: swatch.fonts, r: swatch.rules }, used, parts, format, scale });
}

async function measureOverflow(page) {
  return page.evaluate(() => [...document.querySelectorAll(".stitch.text")].map((el) => ({ stitchId: el.dataset.stitchId, slot: el.dataset.slot || undefined, overflow: el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2 })));
}

/**
 * Did something that should have drawn fail to? A solid full-bleed colour is a
 * perfectly good design, so "all one colour" alone is not blank. Blank means
 * fully transparent, or flat even though the pattern has several visible
 * stitches or visible text that should have made some variation.
 */
async function isBlank(file, pattern, swatch) {
  const st = await sharp(file).stats();
  const flat = st.channels.slice(0, 3).every((c) => c.max === c.min);
  const alpha = st.channels[3];
  if (alpha && alpha.max === 0) return pattern.stitches.length > 0;
  const hidden = (s) => !!resolveStyle(swatch, s.style).hidden;
  const visible = pattern.stitches.filter((s) => !hidden(s));
  const expectsVariation = visible.length >= 2 || visible.some((s) => s.kind === "text" && (s.content ?? "").trim());
  return flat && expectsVariation;
}

async function probeVideo(file) {
  const { out } = await run("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,width,height,pix_fmt,nb_read_frames,duration", "-of", "json", file]);
  const streams = JSON.parse(out ?? "{}").streams ?? [];
  const v = streams.find((s) => s.codec_type === "video") ?? {}, a = streams.find((s) => s.codec_type === "audio");
  return { width: Number(v.width), height: Number(v.height), pixFmt: v.pix_fmt, frames: Number(v.nb_read_frames), videoMs: Math.round(Number(v.duration) * 1000), audioMs: a ? Math.round(Number(a.duration) * 1000) : null };
}

/**
 * What a knit WOULD do, without drawing anything: the units it would make and
 * what the quality gates say about each. Cheap (no browser), so the Knit dialog
 * can show problems before anyone waits for a render.
 */
export function previewKnit(store, { projectId, patternId, params = {} }) {
  const pattern = store.getPattern(patternId);
  const swatch = activeSwatch(store, projectId);
  const yarn = listYarn(store, projectId);
  const yarnMap = Object.fromEntries(yarn.map((y) => [y.id, y]));
  const scale = params.scale === 2 ? 2 : 1;
  return unitsFor(pattern, params, yarn).map((u) => ({ label: u.label, size: u.size, issues: [...u.problems, ...preflight(u.pattern, swatch, { scale, yarn: yarnMap })] }));
}

/**
 * Everything a page needs that is not the pattern itself: the brand, the fonts as
 * file:// faces, Yarn and Parts resolved to files on disk. One place, so a preview
 * and a knit cannot disagree about what the page can see.
 */
export function renderContext(store, projectId, pattern, swatch, yarn, yarnMap) {
  const families = familiesUsed(pattern, swatch);
  const fontFaces = [
    fontFaceCss(families, (f) => pathToFileURL(fontPath(f)).href),
    ...yarn.filter((y) => y.kind === "font").map((y) => `@font-face{font-family:"${(y.meta.family ?? y.name).replace(/"/g, "")}";src:url("${pathToFileURL(join(store.paths.yarnDir(projectId), y.file)).href}");font-display:block}`),
  ].join("\n");
  return {
    swatch, mode: "render", fontFaces,
    part: (id) => { try { return getPart(store, id); } catch { return undefined; } },
    yarn: (id) => { const y = yarnMap[id]; return y && !y.deletedAt ? { url: pathToFileURL(join(store.paths.yarnDir(projectId), y.file)).href, kind: y.kind, mime: y.mime, width: y.width, height: y.height, meta: y.meta, posterUrl: y.meta.thumb ? pathToFileURL(join(store.paths.yarnDir(projectId), ".thumbs", y.meta.thumb)).href : undefined } : undefined; },
  };
}

/** A single still of a pattern, as PNG bytes: what a model uses to look at its own work. */
export async function renderPreview(store, patternId, { timeMs = 0, scale = 1, renderer: injected } = {}) {
  const pattern = store.getPattern(patternId);
  const swatch = activeSwatch(store, pattern.projectId);
  const yarn = listYarn(store, pattern.projectId);
  const yarnMap = Object.fromEntries(yarn.map((y) => [y.id, y]));
  const ctx = renderContext(store, pattern.projectId, pattern, swatch, yarn, yarnMap);
  const dir = join(store.paths.projectDir(pattern.projectId), ".pages");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `preview-${patternId}-${Date.now()}.html`);
  await writeFile(file, pageFor({ ...pattern, background: swatch.colors.find((c) => c.role === "background")?.hex }, ctx), "utf8");
  const renderer = injected ?? (await openRenderer());
  const page = await renderer.newPage({ width: pattern.size.w, height: pattern.size.h, scale });
  try {
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => window.__stage.ready());
    if (timeMs) await page.evaluate((t) => window.__stage.seek(t), timeMs);
    return await page.screenshot({ type: "png" });
  } finally { await page.close(); await rm(file, { force: true }); if (!injected) await renderer.close(); }
}

/** The whole job. Progress goes to the jobs table, so the UI, the CLI and MCP all read the same thing. */
export async function runKnit(store, { jobId, projectId, patternId, params = {}, signal, renderer: injected }) {
  const format = FORMATS[params.format ?? "png"] ? (params.format === "jpg" ? "jpeg" : params.format ?? "png") : "png";
  const scale = params.scale === 2 ? 2 : 1;
  const pattern = store.getPattern(patternId);
  const swatch = activeSwatch(store, projectId);
  const yarn = listYarn(store, projectId);
  const yarnMap = Object.fromEntries(yarn.map((y) => [y.id, y]));
  const motion = pattern.durationMs > 0;
  const fmt = motion ? "mp4" : format;
  const units = unitsFor(pattern, params, yarn);
  const batchId = units.length > 1 ? `bt_${Date.now().toString(36)}` : null;
  const day = new Date().toISOString().slice(0, 10);
  const outRoot = store.paths.outDir(projectId);
  const pagesDir = join(store.paths.projectDir(projectId), ".pages");
  await mkdir(join(outRoot, day), { recursive: true });
  await mkdir(pagesDir, { recursive: true });

  const progress = { total: units.length, done: 0, current: null, units: [] };
  const publish = () => store.updateJob(jobId, { status: "running", progress });
  publish();

  const own = !injected;
  const renderer = injected ?? (await openRenderer({ backend: params.backend ?? "playwright" }));
  const results = [];
  try {
    for (const [n, unit] of units.entries()) {
      if (signal?.aborted) throw new Cancelled();
      progress.current = unit.label; publish();
      const entry = { label: unit.label, status: "pending", issues: [...unit.problems] };
      progress.units.push(entry);
      try {
        const issues = [...unit.problems, ...preflight(unit.pattern, swatch, { scale, yarn: yarnMap })];
        entry.issues = issues;
        if (hasErrors(issues)) { entry.status = "failed"; continue; }

        const hash = hashFor(store, unit, swatch, yarnMap, fmt, scale);
        const prior = params.reuse === false ? null : findKnitByHash(store, projectId, hash);
        if (prior && (await stat(knitPath(store, prior)).then(() => true, () => false))) { entry.status = "reused"; entry.knitId = prior.id; results.push(prior); continue; }

        const ctx = renderContext(store, projectId, unit.pattern, swatch, yarn, yarnMap);
        const bgForOpaque = fmt === "jpg" || fmt === "jpeg" ? { background: swatch.colors.find((c) => c.role === "background")?.hex ?? "#ffffff" } : {};
        const html = pageFor({ ...unit.pattern, ...bgForOpaque }, ctx);
        const pageFile = join(pagesDir, `${jobId}-${n}.html`);
        await writeFile(pageFile, html, "utf8");

        const page = await renderer.newPage({ width: unit.size.w, height: unit.size.h, scale });
        const base = `${slug(pattern.name)}-${slug(unit.size.name)}${unit.row ? `-${unit.rowIndex + 1}-${slug(String(unit.row.headline ?? Object.values(unit.row)[0] ?? ""))}` : ""}-${hash.slice(0, 6)}`;
        let outFile, report = {};
        try {
          await page.goto(pathToFileURL(pageFile).href);
          await page.evaluate(() => window.__stage.ready());
          issues.push(...overflowIssues(await measureOverflow(page)));
          if (motion) {
            const { knit } = await import("./knit.mjs");
            const r = await knit(page, { outDir: join(outRoot, day), name: `${base}.silent`, durationMs: unit.pattern.durationMs, fps: FPS, signal });
            outFile = r.files[0];
            const sounds = (unit.pattern.motion?.audio ?? []).filter((a) => yarnMap[a.yarnId] && !yarnMap[a.yarnId].deletedAt);
            if (sounds.length) {
              // Mix, measure, then lay the sound over the picture WITHOUT touching a frame,
              // and prove it: the decoded video must hash the same before and after.
              const mixFile = join(outRoot, day, `${base}.mix.wav`);
              await mixAudio({ durationMs: unit.pattern.durationMs, out: mixFile, clips: sounds.map((a) => ({
                file: join(store.paths.yarnDir(projectId), yarnMap[a.yarnId].file), startMs: a.startMs, kind: a.kind, gain: a.gain, fadeInMs: a.fadeInMs, fadeOutMs: a.fadeOutMs, loop: a.loop, lengthMs: yarnMap[a.yarnId].durationMs,
              })) });
              const loud = await measureLoudness(mixFile);
              const finalFile = join(outRoot, day, `${base}.mp4`);
              await muxAudio({ video: outFile, audio: mixFile, out: finalFile });
              if ((await videoHash(outFile)) !== (await videoHash(finalFile))) throw new Error("Adding the sound changed the picture. The file was thrown away.");
              await rm(outFile, { force: true }); await rm(mixFile, { force: true });
              outFile = finalFile; report = { ...report, lufs: loud.lufs, truePeak: loud.truePeak };
            } else {
              const finalFile = join(outRoot, day, `${base}.mp4`);
              await rename(outFile, finalFile); // fs, not `mv`: this runs on Windows too
              outFile = finalFile;
            }
          } else {
            const target = join(outRoot, day, `${base}.${FORMATS[fmt]}`);
            if (fmt === "webp") {
              const png = await page.screenshot({ omitBackground: true, type: "png" });
              await sharp(png).webp({ quality: 90 }).toFile(target);
            } else {
              await page.screenshot({ path: target, omitBackground: fmt === "png", type: fmt === "png" ? "png" : "jpeg", quality: fmt === "png" ? undefined : 92 });
            }
            outFile = target;
          }
        } finally { await page.close(); await rm(pageFile, { force: true }); }

        // Verify what we made, with checks that have each been seen to fail.
        let post;
        if (motion) {
          const v = await probeVideo(outFile);
          post = postflight({ kind: "video", width: v.width, height: v.height, expectW: unit.size.w * scale, expectH: unit.size.h * scale, pixFmt: v.pixFmt, frames: v.frames, expectFrames: frameTimes(unit.pattern.durationMs, FPS).length, videoMs: v.videoMs, audioMs: v.audioMs });
          report.frames = v.frames;
        } else {
          const m = await sharp(outFile).metadata();
          post = postflight({ kind: "image", width: m.width, height: m.height, expectW: unit.size.w * scale, expectH: unit.size.h * scale, blank: await isBlank(outFile, unit.pattern, swatch) });
        }
        issues.push(...post.issues);
        report = { ...report, issues, checks: post.checks };
        if (hasErrors(post.issues)) { await rm(outFile, { force: true }); entry.status = "failed"; entry.issues = issues; continue; }

        const st = await stat(outFile);
        const rec = insertKnit(store, {
          projectId, patternId, patternName: pattern.name, jobId, batchId, label: unit.label, file: `${day}/${outFile.split("/").pop()}`,
          kind: motion ? "video" : "image", format: fmt, width: unit.size.w * scale, height: unit.size.h * scale, bytes: st.size,
          durationMs: motion ? unit.pattern.durationMs : null, hash, report,
        });
        entry.status = "done"; entry.knitId = rec.id; entry.issues = issues;
        results.push(rec);
      } catch (e) {
        if (e instanceof Cancelled || e?.kind === "cancelled") throw e;
        entry.status = "failed";
        entry.issues.push({ level: "error", code: "render-failed", message: `This one could not be drawn: ${String(e?.message ?? e).split("\n")[0]}` });
      } finally {
        progress.done = n + 1; publish();
      }
    }
    const failed = progress.units.filter((u) => u.status === "failed").length;
    store.updateJob(jobId, { status: failed === units.length ? "failed" : "done", progress, result: { knitIds: results.map((r) => r.id), failed }, error: failed === units.length ? "Nothing could be knitted. Open the report to see why." : null });
    return { knits: results, progress };
  } catch (e) {
    if (e instanceof Cancelled || e?.kind === "cancelled") {
      store.updateJob(jobId, { status: "cancelled", progress, result: { knitIds: results.map((r) => r.id) }, error: "Cancelled." });
      return { knits: results, progress, cancelled: true };
    }
    store.updateJob(jobId, { status: "failed", progress, error: String(e?.message ?? e) });
    throw e;
  } finally {
    if (own) await renderer.close();
  }
}

export { SIZES };
