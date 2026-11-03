// The voices. Every provider turns text into a WAV file and nothing else, so the
// rest of the product (timeline, captions, the mixer) never knows which one made it.

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export class VoiceError extends Error { constructor(m, kind = "voice") { super(m); this.kind = kind; } }

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

/**
 * Any server that speaks OpenAI's `/v1/audio/speech`: Kokoro or Piper behind
 * llm-factory, LM Studio, a local server, a cloud API. A base URL is the whole integration.
 */
export function openaiCompatible({ baseUrl, apiKey, model = "tts-1", fetchImpl = fetch } = {}) {
  return {
    id: "openai", label: "A voice server on your network",
    async available() { return !!baseUrl; },
    async voices() { return [{ id: "alloy", label: "alloy" }, { id: "nova", label: "nova" }, { id: "af_heart", label: "af_heart (Kokoro)" }]; },
    async synthesize({ text, voice = "alloy", speed = 1, out }) {
      if (!baseUrl) throw new VoiceError("Add your voice server's address in Settings first.", "config");
      const url = `${baseUrl.replace(/\/+$/, "")}/v1/audio/speech`;
      let res;
      try {
        res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify({ model, input: text, voice, speed, response_format: "wav" }), signal: AbortSignal.timeout(120_000) });
      } catch (e) {
        const host = new URL(baseUrl).host;
        throw new VoiceError(`Could not reach ${host}. Is your voice server running? (${e.cause?.code ?? e.name})`, "unreachable");
      }
      if (res.status === 401 || res.status === 403) throw new VoiceError("The voice server rejected your key. Check it in Settings.", "auth");
      if (!res.ok) throw new VoiceError(`The voice server answered ${res.status}. ${(await res.text()).slice(0, 160)}`, "server");
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
