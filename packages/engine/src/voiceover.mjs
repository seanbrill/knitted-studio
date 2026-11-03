// Voiceover as a job: a script becomes sound on the timeline.
//
// Each line is spoken (cached, so twelve posts sharing three lines speak three
// times), kept as audio Yarn so it can be reused and replaced like any other file,
// and placed on the timeline one after another. Captions come from the real length
// of each spoken line, not from a guess.

import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { captionCommands, motionEnd } from "@knitted/core";
import { activeSwatch, getSecret, importYarn, uploadTempPath } from "@knitted/core/node";
import { providerFromSettings, speak, VoiceError } from "@knitted/voice";

/** The provider the user configured, with its key fetched from the OS keychain at the last moment. */
export async function activeVoice(store) {
  const s = store.getSetting("voice", { provider: "system", voice: "default", speed: 1 });
  const apiKey = s.provider === "openai" ? await getSecret("voice_openai", store.paths.root) : undefined;
  return { settings: s, provider: providerFromSettings({ ...s, apiKey }) };
}

export async function runVoiceover(store, { jobId, projectId, patternId, lines, voice, speed, gapMs = 350, startMs = 500, captions = false, actor = "human" }) {
  const { settings, provider } = await activeVoice(store);
  const clean = lines.map((l) => String(l).trim()).filter(Boolean);
  if (!clean.length) throw new VoiceError("Write at least one line to say.");
  const progress = { total: clean.length, done: 0, current: null, units: [] };
  store.updateJob(jobId, { status: "running", progress });
  try {
    const pattern = store.getPattern(patternId);
    let t = startMs;
    const clips = [], spoken = [];
    for (const [i, text] of clean.entries()) {
      progress.current = text; store.updateJob(jobId, { progress });
      const r = await speak(provider, { text, voice: voice ?? settings.voice, speed: speed ?? settings.speed ?? 1, cacheDir: store.paths.cacheDir });
      const tmp = uploadTempPath(store, projectId);
      await mkdir(join(tmp, ".."), { recursive: true });
      await copyFile(r.file, tmp);
      const { yarn } = await importYarn(store, projectId, tmp, `voice-${i + 1}.wav`, { name: `Voice: ${text.slice(0, 28)}`, tags: ["voiceover"], actor: actor === "model" ? "model" : "human" });
      clips.push({ id: `au_${Math.random().toString(36).slice(2, 8)}`, yarnId: yarn.id, startMs: Math.round(t), kind: "voice", label: text });
      spoken.push({ text, startMs: Math.round(t), endMs: Math.round(t + r.durationMs) });
      t += r.durationMs + gapMs;
      progress.done = i + 1; progress.units.push({ label: text, status: r.cached ? "reused" : "done", issues: [] });
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
