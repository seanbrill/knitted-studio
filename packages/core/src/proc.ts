// A small, bounded subprocess runner for the optional tools (ffmpeg, ffprobe).
// Bounded because a hung ffmpeg is indistinguishable from a slow one.

import { spawn } from "node:child_process";

export function run(cmd: string, args: string[], opts: { timeoutMs?: number; binary?: boolean } = {}): Promise<{ out: Buffer; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${cmd} did not finish within ${opts.timeoutMs ?? 60_000}ms`)); }, opts.timeoutMs ?? 60_000);
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out: Buffer.concat(chunks), err });
      else reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`));
    });
  });
}

const cache = new Map<string, boolean>();
/** Is a tool installed? Cached: the answer does not change during a run. */
export async function hasTool(name: string): Promise<boolean> {
  if (cache.has(name)) return cache.get(name)!;
  let ok = false;
  try { await run(name, ["-version"], { timeoutMs: 8000 }); ok = true; } catch { ok = false; }
  cache.set(name, ok);
  return ok;
}
