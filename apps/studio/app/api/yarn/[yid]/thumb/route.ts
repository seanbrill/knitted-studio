import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { getYarn, yarnThumbPath } from "@knitted/core/node";
import { fail, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request, { params }: { params: Promise<{ yid: string }> }) => {
  const s = store();
  const y = getYarn(s, (await params).yid);
  const p = yarnThumbPath(s, y);
  if (!p) return fail(404, "not_found", "This kind of Yarn has no preview.");
  const versioned = new URL(req.url).searchParams.has("v");
  return new Response(readFileSync(p), {
    headers: { "content-type": extname(p) === ".jpg" ? "image/jpeg" : "image/webp", "cache-control": versioned ? "private, max-age=31536000, immutable" : "private, no-cache" },
  });
});
