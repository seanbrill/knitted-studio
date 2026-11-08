// Voiceover as a job: a script becomes sound on the timeline.
//
// The whole script is spoken in one take, so it is one voice from start to end: a model
// asked for each line alone speaks each a little differently. The take is then cut at the
// pauses between lines (oneTake: false speaks each line on its own, cached, so twelve posts
// sharing three lines speak three times). Each line is kept as audio Yarn so it can be reused and replaced like any other file,
// and placed on the timeline one after another. Captions come from the real length
// of each spoken line, not from a guess.

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { captionCommands, codeOnScreen, motionEnd, spokenProblem } from "@knitted/core";
import { activeSwatch, getSecret, importYarn, uploadTempPath } from "@knitted/core/node";
import { cutTake, providerFromSettings, speak, VoiceError } from "@knitted/voice";

/** The provider the user configured, with its key fetched from the OS keychain at the last moment. */
export async function activeVoice(store) {
  const s = store.getSetting("voice", { provider: "system", voice: "default", speed: 1 });
  const apiKey = s.provider === "openai" ? await getSecret("voice_openai", store.paths.root) : undefined;
  return { settings: s, provider: providerFromSettings({ ...s, apiKey }) };
}

/** A line as it goes into one take: ending as a sentence ends, so the voice pauses after it. */
const asSaid = (l) => (/[.!?…。！？]["')\]]*$/.test(l) ? l : `${l}.`);

/** A script line: what is said, and what the caption shows. A plain string is both. */
export const scriptLine = (l) => {
  const say = String((l && typeof l === "object" ? l.say : l) ?? "").trim();
  const show = String((l && typeof l === "object" ? (l.show ?? l.say) : l) ?? "").trim() || say;
  return { say, show };
};

export async function runVoiceover(store, { jobId, projectId, patternId, lines, voice, speed, style, options, oneTake = true, gapMs = 350, startMs = 500, captions = false, actor = "human" }) {
  const { settings, provider } = await activeVoice(store);
  const script = lines.map(scriptLine).filter((l) => l.say);
  if (!script.length) throw new VoiceError("Write at least one line to say.");
  const clean = script.map((l) => l.say);
  const progress = { total: clean.length, done: 0, current: null, units: [] };
  store.updateJob(jobId, { status: "running", progress });
  try {
    const pattern = store.getPattern(patternId);
    const code = codeOnScreen(pattern);
    const unit = (i, status, more = []) => ({ label: script[i].say, status, issues: [...(spokenProblem(script[i].say, code) ? [{ level: "warning", code: "voice-reads-code", message: spokenProblem(script[i].say, code) }] : []), ...more] });
    let t = startMs;
    const clips = [], spoken = [];
    const say = { voice: voice ?? settings.voice, speed: speed ?? settings.speed ?? 1, cacheDir: store.paths.cacheDir, style, options };
    const keep = async (file, i, text) => {
      const tmp = uploadTempPath(store, projectId);
      await mkdir(join(tmp, ".."), { recursive: true });
      if (Buffer.isBuffer(file)) await writeFile(tmp, file); else await copyFile(file, tmp);
      return (await importYarn(store, projectId, tmp, `voice-${i + 1}.wav`, { name: `Voice: ${text.slice(0, 28)}`, tags: ["voiceover"], actor: actor === "model" ? "model" : "human" })).yarn;
    };
    if (oneTake && clean.length > 1) {
      progress.current = "The whole script, in one take"; store.updateJob(jobId, { progress });
      const r = await speak(provider, { ...say, text: clean.map(asSaid).join("\n\n"), max: 20_000 });
      const parts = cutTake(await readFile(r.file), clean);
      const joined = new Map(); // line index -> the lines it shares a clip with
      if (!parts) {
        // A WAV this cannot cut: the take goes on whole, the captions timed by each line's length.
        const yarn = await keep(r.file, 0, clean.join(" "));
        clips.push({ id: `au_${Math.random().toString(36).slice(2, 8)}`, yarnId: yarn.id, startMs: Math.round(t), kind: "voice", label: clean.join(" ") });
        const total = clean.reduce((a, l) => a + l.length, 0);
        let at = t;
        for (const [i, text] of clean.entries()) { const d = (r.durationMs * text.length) / total; spoken.push({ text: script[i].show, startMs: Math.round(at), endMs: Math.round(at + d) }); at += d; }
      } else {
        let i = 0;
        for (const [n, part] of parts.entries()) {
          const yarn = await keep(part.wav, n, part.text);
          clips.push({ id: `au_${Math.random().toString(36).slice(2, 8)}`, yarnId: yarn.id, startMs: Math.round(t + part.fromMs), kind: "voice", label: part.text });
          const first = i + 1;
          for (const l of part.lines) { spoken.push({ text: script[i].show, startMs: Math.round(t + l.fromMs), endMs: Math.round(t + l.toMs) }); if (part.lines.length > 1) joined.set(i, [first, first + part.lines.length - 1]); i++; }
        }
      }
      progress.done = clean.length;
      progress.units.push(...clean.map((_, i) => unit(i, r.cached ? "reused" : "done", joined.has(i) && joined.get(i)[0] === i + 1 ? [{ level: "warning", code: "voice-joined", message: `Lines ${joined.get(i)[0]} to ${joined.get(i)[1]} are one clip: the voice ran them together without a clear pause, so cutting them apart would split a word. Their captions are timed by length. To move them separately, make the voiceover again, or speak those lines one by one (oneTake off).` }] : [])));
      store.updateJob(jobId, { progress });
    }
    for (const [i, text] of (oneTake && clean.length > 1 ? [] : clean).entries()) {
      progress.current = text; store.updateJob(jobId, { progress });
      const r = await speak(provider, { ...say, text });
      const yarn = await keep(r.file, i, text);
      clips.push({ id: `au_${Math.random().toString(36).slice(2, 8)}`, yarnId: yarn.id, startMs: Math.round(t), kind: "voice", label: text });
      spoken.push({ text: script[i].show, startMs: Math.round(t), endMs: Math.round(t + r.durationMs) });
      t += r.durationMs + gapMs;
      progress.done = i + 1; progress.units.push(unit(i, r.cached ? "reused" : "done"));
      store.updateJob(jobId, { progress });
    }
    const existing = pattern.motion?.audio ?? [];
    const audio = [...existing, ...clips];
    const cmds = [{ type: "setAudio", audio }];
    if (captions) cmds.push(...captionCommands(spoken, pattern.stitches.map((s) => s.slot)));
    const end = Math.max(pattern.durationMs, spoken.at(-1).endMs + 700, motionEnd({ tracks: {} }));
    if (end > pattern.durationMs) cmds.push({ type: "setMeta", durationMs: end });
    store.apply(patternId, { type: "batch", commands: cmds }, actor, { label: "Voiceover" });
    store.updateJob(jobId, { status: "done", progress, result: { clips: clips.length, spoken } });
    return { clips, spoken };
  } catch (e) {
    store.updateJob(jobId, { status: "failed", progress, error: e instanceof VoiceError || e?.kind ? String(e.message) : `The voiceover could not be made: ${String(e?.message ?? e)}` });
    throw e;
  }
}

export function startVoiceJob(store, args) {
  store.getPattern(args.patternId);
  const job = store.createJob("tts", args.projectId, { patternId: args.patternId, lines: args.lines.length });
  runVoiceover(store, { ...args, jobId: job.id }).catch(() => { /* recorded on the job */ });
  return job;
}
export { activeSwatch };
