import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { getKnit, knitPath, markKnitsSeen } from "@knitted/core/node";
import { fail, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4" };

export const GET = route(async (req: Request, { params }: { params: Promise<{ kid: string }> }) => {
  const s = store();
  const k = getKnit(s, (await params).kid);
  const file = knitPath(s, k);
  let size: number;
  try { size = statSync(file).size; } catch { return fail(404, "not_found", "That file is no longer on disk. Knit it again."); }
  const headers: Record<string, string> = { "content-type": MIME[k.format] ?? "application/octet-stream", "accept-ranges": "bytes", "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" };
  // Downloading a knit is looking at it.
  if (new URL(req.url).searchParams.has("download")) { headers["content-disposition"] = `attachment; filename="${k.file.split("/").pop()}"`; if (!k.seenAt) markKnitsSeen(s, [k.id]); }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && size > 0) {
    const start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
    const end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...headers, "content-length": String(size) } });
});
