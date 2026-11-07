// The voices. Every provider turns text into a WAV file and nothing else, so the
// rest of the product (timeline, captions, the mixer) never knows which one made it.

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export class VoiceError extends Error { constructor(m, kind = "voice") { super(m); this.kind = kind; this.name = "VoiceError"; } }

function run(cmd, args, { input, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let err = "", out = "";
    const t = setTimeout(() => { c.kill("SIGKILL"); reject(new VoiceError(`${cmd} did not finish in ${timeoutMs / 1000}s`)); }, timeoutMs);
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
    c.on("error", (e) => { clearTimeout(t); reject(e.code === "ENOENT" ? new VoiceError(`${cmd} is not installed.`, "missing") : e); });
    c.on("close", (code) => { clearTimeout(t); if (code === 0) resolve({ out, err }); else reject(new VoiceError(`${cmd} failed: ${err.slice(-300)}`)); });
    if (input !== undefined) c.stdin.end(input); else c.stdin.end();
  });
}

/** The platform's own voice. Lowest quality and zero setup: the fallback that always works. */
export const system = {
  id: "system", label: "Basic voice (built into your computer)",
  async available() {
    const cmd = process.platform === "darwin" ? "say" : process.platform === "win32" ? "powershell" : "espeak-ng";
    try { await run(cmd, process.platform === "darwin" ? ["-v", "?"] : process.platform === "win32" ? ["-Command", "1"] : ["--version"], { timeoutMs: 8000 }); return true; } catch { return false; }
  },
  async voices() {
    if (process.platform !== "darwin") return [{ id: "default", label: "Default" }];
    const { out } = await run("say", ["-v", "?"]);
    return out.split("\n").map((l) => /^(\S[^#]*?)\s{2,}([a-z]{2}_[A-Z]{2})\s+#/.exec(l)).filter(Boolean).map((m) => ({ id: m[1].trim(), label: `${m[1].trim()} (${m[2]})` }));
  },
  async synthesize({ text, voice, speed = 1, out }) {
    await mkdir(dirname(out), { recursive: true });
    if (process.platform === "darwin") {
      const aiff = join(tmpdir(), `kn-say-${Date.now()}-${Math.random().toString(36).slice(2)}.aiff`);
      await run("say", [...(voice && voice !== "default" ? ["-v", voice] : []), "-r", String(Math.round(180 * speed)), "-o", aiff, "--", text]);
      await run("ffmpeg", ["-v", "error", "-y", "-i", aiff, "-ac", "1", "-ar", "24000", out]);
      await rm(aiff, { force: true });
    } else if (process.platform === "win32") {
      const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = ${Math.round((speed - 1) * 6)}; $s.SetOutputToWaveFile('${out.replace(/'/g, "''")}'); $s.Speak([Console]::In.ReadToEnd()); $s.Dispose()`;
      await run("powershell", ["-NoProfile", "-Command", ps], { input: text });
    } else {
      await run("espeak-ng", ["-s", String(Math.round(160 * speed)), "-w", out, "--", text]);
    }
  },
};

// Speakers a model has but its server may not list: Qwen3-TTS CustomVoice's presets.
const FAMILY_VOICES = {
  qwen3_tts: [["Ryan", "English male, energetic"], ["Aiden", "English male, sunny"], ["Vivian", "Chinese female, bright"], ["Serena", "Chinese female, warm"], ["Uncle_Fu", "Chinese male, mellow"], ["Dylan", "Beijing male, youthful"], ["Eric", "Sichuan male, lively"], ["Ono_Anna", "Japanese female, playful"], ["Sohee", "Korean female, warm"]],
};
const voiceOf = (v) => (typeof v === "string" ? { id: v, label: v } : v && (v.id ?? v.voice_id ?? v.name) ? { id: String(v.id ?? v.voice_id ?? v.name), label: [v.name ?? v.id ?? v.voice_id, v.description].filter(Boolean).join(", ") } : null);

/**
 * Any server that speaks OpenAI's `/v1/audio/speech`: Kokoro or Piper behind
 * llm-factory, LM Studio, a local server, a cloud API. A base URL is the whole integration.
 * `style` goes as `instructions` (how to say it, in words), and `options` go in the request
 * as they are, for whatever else the server takes: a model's full range, not just a voice.
 */
export function openaiCompatible({ baseUrl, apiKey, model = "tts-1", style = "", options = {}, fetchImpl = fetch } = {}) {
  const root = (baseUrl ?? "").replace(/\/+$/, "");
  const headers = { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };
  let resolved = null;
  const get = async (path) => { try { const r = await fetchImpl(`${root}${path}`, { headers, signal: AbortSignal.timeout(5000) }); return r.ok ? await r.json() : null; } catch { return null; } };
  return {
    id: "openai", label: "A voice server on your network",
    cacheExtra: JSON.stringify([root, model, style, options]),
    async available() { return !!baseUrl; },
    /** The models the server has loaded, with what kind each is (its family). */
    async models() { const m = await get("/v1/models"); return (m?.data ?? []).map((x) => ({ id: String(x.id), family: x.family ?? null, task: x.task ?? null })); },
    /** The voices the server lists, and the presets its model is known to have. */
    async voices() {
      const listed = await get("/v1/audio/voices");
      const out = (Array.isArray(listed) ? listed : listed?.voices ?? listed?.data ?? []).map(voiceOf).filter(Boolean);
      const family = (await this.models()).find((x) => x.id === model)?.family ?? (await this.models())[0]?.family;
      for (const [id, label] of FAMILY_VOICES[family] ?? []) if (!out.some((v) => v.id.toLowerCase() === id.toLowerCase())) out.push({ id, label: `${id}, ${label}` });
      if (out.length || listed) return out;
      return [{ id: "alloy", label: "alloy" }, { id: "nova", label: "nova" }, { id: "af_heart", label: "af_heart (Kokoro)" }];
    },
    async synthesize({ text, voice, speed = 1, out, style: say, options: more }) {
      if (!baseUrl) throw new VoiceError("Add your voice server's address in Settings first.", "config");
      const how = say ?? style;
      // A model name the server does not have (a typo, a label) is its own speech model, when it says which.
      resolved ??= this.models().then((ms) => (!ms.length || ms.some((m) => m.id === model) ? model : (ms.find((m) => m.task === "tts") ?? ms[0]).id), () => model);
      const body = { model: await resolved, input: text, ...(voice && voice !== "default" ? { voice } : {}), speed, response_format: "wav", ...(how ? { instructions: how } : {}), ...options, ...(more ?? {}) };
      let res;
      try {
        res = await fetchImpl(`${root}/v1/audio/speech`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
      } catch (e) {
        const host = new URL(baseUrl).host;
        throw new VoiceError(`Could not reach ${host}. Is your voice server running? (${e.cause?.code ?? e.name})`, "unreachable");
      }
      if (res.status === 401 || res.status === 403) throw new VoiceError("The voice server rejected your key. Check it in Settings.", "auth");
      if (!res.ok) {
        const raw = await res.text();
        let said = raw; try { said = JSON.parse(raw)?.error?.message ?? raw; } catch { /* not JSON */ }
        const hint = /speaker|voice/i.test(said) ? " Pick another voice in Settings." : /model/i.test(said) ? " Check the model name in Settings." : "";
        throw new VoiceError(`The voice server said: ${String(said).slice(0, 200)}.${hint}`, "server");
      }
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, Buffer.from(await res.arrayBuffer()));
    },
  };
}

/** Piper: small, fast, runs on a CPU. Needs its binary and a downloaded voice model. */
export function piper({ binary, model } = {}) {
  return {
    id: "piper", label: "Piper (local, downloaded once)",
    async available() { if (!binary || !model) return false; try { await readFile(model); await run(binary, ["--help"], { timeoutMs: 8000 }).catch(() => ({})); return true; } catch { return false; } },
    async voices() { return model ? [{ id: model, label: model.split("/").pop().replace(/\.onnx$/, "") }] : []; },
    async synthesize({ text, speed = 1, out }) {
      if (!binary || !model) throw new VoiceError("Piper is not set up yet. Download a voice in Settings.", "config");
      await mkdir(dirname(out), { recursive: true });
      await run(binary, ["--model", model, "--length_scale", String(1 / speed), "--output_file", out], { input: text });
    },
  };
}
