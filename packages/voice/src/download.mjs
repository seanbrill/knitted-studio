// Downloading a model or a voice: explicit, resumable, and verified.
//
// Nothing here runs unless a person pressed a button that says what it will
// download and how big it is (decision D10). A partial file is kept under a
// `.part` name and resumed with a Range request; the finished file is only moved
// into place after its SHA-256 matches the one pinned in the manifest, so a
// truncated or tampered download is rejected instead of loaded.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export class DownloadError extends Error { constructor(m, kind = "download") { super(m); this.kind = kind; } }

async function sha256(file) {
  const h = createHash("sha256");
  for await (const c of createReadStream(file)) h.update(c);
  return h.digest("hex");
}

/**
 * @param {string} url
 * @param {string} dest final path
 * @param {{ sha256?: string, onProgress?: (done: number, total: number) => void, signal?: AbortSignal }} [o]
 */
export async function downloadFile(url, dest, { sha256: want, onProgress, signal } = {}) {
  await mkdir(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let have = await stat(part).then((s) => s.size, () => 0);
  const res = await fetch(url, { signal, headers: have ? { range: `bytes=${have}-` } : {}, redirect: "follow" }).catch((e) => { throw new DownloadError(`Could not reach ${new URL(url).host}: ${e.message}`); });
  if (res.status === 416) { have = 0; await rm(part, { force: true }); return downloadFile(url, dest, { sha256: want, onProgress, signal }); }
  if (!res.ok && res.status !== 206) throw new DownloadError(`${new URL(url).host} answered ${res.status}. The file may have moved.`);
  // A server that ignores Range sends 200 with the whole file: start over rather than append to a partial.
  const resumed = res.status === 206;
  if (!resumed) { have = 0; await rm(part, { force: true }); }
  const total = have + Number(res.headers.get("content-length") ?? 0);
  let done = have;
  const out = createWriteStream(part, { flags: resumed ? "a" : "w" });
  const tick = new Transform({ transform(c, _e, cb) { done += c.length; onProgress?.(done, total); cb(null, c); } });
  await pipeline(Readable.fromWeb(res.body), tick, out, { signal });
  if (want) {
    const got = await sha256(part);
    if (got !== want) { await rm(part, { force: true }); throw new DownloadError("That download did not match its checksum, so it was thrown away. Try again, and if it keeps happening the file has changed upstream.", "checksum"); }
  }
  await rename(part, dest);
  return { path: dest, bytes: done };
}
