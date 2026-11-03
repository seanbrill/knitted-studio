import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { extname } from "node:path";
import { getYarn, replaceTempPath, importYarn, yarnPath } from "@knitted/core/node";
import { fail, route, store, ok } from "@/lib/server";
import { bodyToFile } from "@/lib/upload-stream";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ yid: string }> };

/**
 * Serve the original bytes, with Range support: a browser cannot scrub a video
 * or seek audio from a server that only answers whole-file requests.
 */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const s = store();
  const y = getYarn(s, (await params).yid);
  const file = yarnPath(s, y);
  let size: number;
  try { size = statSync(file).size; } catch { return fail(404, "not_found", "The file for this Yarn is missing from disk."); }
  const versioned = new URL(req.url).searchParams.has("v");
  const headers: Record<string, string> = {
    "content-type": y.mime,
    "accept-ranges": "bytes",
    etag: `"${y.hash}"`,
    "cache-control": versioned ? "private, max-age=31536000, immutable" : "private, no-cache",
    "x-content-type-options": "nosniff",
    // An SVG opened directly in a tab must not be able to run script.
    ...(extname(file) === ".svg" ? { "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:" } : {}),
  };
  if (req.headers.get("if-none-match") === headers.etag) return new Response(null, { status: 304, headers });

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && size > 0) {
    let start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
    const end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    start = Math.max(0, start);
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...headers, "content-length": String(size) } });
});

/** Replace the file but keep the id, so every Pattern using it updates. */
export const PUT = route(async (req: Request, { params }: Ctx) => {
  const s = store();
  const y = getYarn(s, (await params).yid);
  const filename = new URL(req.url).searchParams.get("filename") ?? y.originalName;
  const tmp = replaceTempPath(s, y.projectId);
  await bodyToFile(req, tmp, 2 * 1024 ** 3);
  return ok(await importYarn(s, y.projectId, tmp, filename, { replaceId: y.id }));
});
