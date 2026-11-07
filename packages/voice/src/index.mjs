// Voiceover: text in, WAV out, with caching and honest timings.

import { createHash } from "node:crypto";
import { stat, mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { openaiCompatible, piper, system, VoiceError } from "./providers.mjs";

export { openaiCompatible, piper, system, VoiceError };
export { downloadFile, DownloadError } from "./download.mjs";
export { cutTake, readWav } from "./wav.mjs";

/** Build the active provider from saved settings. */
export function providerFromSettings(s = {}) {
  if (s.provider === "openai") return openaiCompatible({ baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, style: s.style, options: s.options });
  if (s.provider === "piper") return piper({ binary: s.piperBinary, model: s.piperModel });
  return system;
}

/** Length of an audio file in ms, from the file itself. */
export function durationOf(file) {
  return new Promise((resolve, reject) => {
    const c = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d));
    c.on("error", () => reject(new VoiceError("ffprobe is needed to measure a voiceover.", "missing")));
    c.on("close", () => { const s = Number(out.trim()); if (Number.isFinite(s) && s > 0) resolve(Math.round(s * 1000)); else reject(new VoiceError("That voiceover could not be measured. It may be empty.")); });
  });
}

/**
 * Word timings. A provider that reports them would win; none of the local ones
 * do, so this spreads the line's real duration across its words in proportion to
 * their length. Honest and good enough to pace captions; it is an ESTIMATE, and
 * the caption feature says so.
 */
export function estimateWords(text, durationMs, startMs = 0) {
  const words = text.trim().match(/\S+/g) ?? [];
  if (!words.length) return [];
  const weight = words.map((w) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, "").length) + (/[,.;:!?]$/.test(w) ? 3 : 0));
  const total = weight.reduce((a, b) => a + b, 0);
  let t = startMs;
  return words.map((w, i) => { const d = (weight[i] / total) * durationMs; const o = { text: w, startMs: Math.round(t), endMs: Math.round(t + d) }; t += d; return o; });
}

/** The cache key: anything that changes the sound changes the key. */
export const cacheKey = ({ text, voice, speed, provider, model }) => createHash("sha256").update(JSON.stringify([text, voice ?? "", speed ?? 1, provider, model ?? ""])).digest("hex").slice(0, 32);

/**
 * Synthesise one line, using the cache so twelve posts that share three lines
 * speak three times. Returns the WAV path, its length and word timings.
 * @param {any} provider
 * @param {{ text: string, voice?: string, speed?: number, cacheDir: string, style?: string, options?: Record<string, unknown>, max?: number }} o
 */
export async function speak(provider, { text, voice, speed = 1, cacheDir, style, options, max = 4000 }) {
  const clean = String(text ?? "").trim();
  if (!clean) throw new VoiceError("There is nothing to say. Write a line first.");
  if (clean.length > max) throw new VoiceError("That line is too long to voice in one go. Split it into shorter lines.");
  const key = cacheKey({ text: clean, voice, speed, provider: provider.id, model: JSON.stringify([provider.cacheExtra ?? "", style ?? "", options ?? {}]) });
  await mkdir(join(cacheDir, "tts"), { recursive: true });
  const file = join(cacheDir, "tts", `${key}.wav`);
  const cached = await stat(file).then(() => true, () => false);
  if (!cached) await provider.synthesize({ text: clean, voice, speed, out: file, style, options });
  const durationMs = await durationOf(file);
  return { file, durationMs, words: estimateWords(clean, durationMs), cached };
}

export async function copyTo(file, dest) { await mkdir(join(dest, ".."), { recursive: true }); await copyFile(file, dest); }
