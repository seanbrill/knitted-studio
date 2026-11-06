import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { getYarn, yarnPicturePath, yarnThumbPath, yarnTilePath } from "@knitted/core/node";
import { fail, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** The thumbnail, or with ?size=large the bigger preview a project's card shows, or ?size=tile (or top) a grid's square. */
export const GET = route(async (req: Request, { params }: { params: Promise<{ yid: string }> }) => {
  const s = store();
  const y = getYarn(s, (await params).yid);
  const q = new URL(req.url).searchParams;
  const size = q.get("size");
  const p = size === "large" ? await yarnPicturePath(s, y) : size === "tile" || size === "top" ? await yarnTilePath(s, y, size === "top") : yarnThumbPath(s, y);
  if (!p) return fail(404, "not_found", "This kind of Yarn has no preview.");
  const versioned = q.has("v");
  return new Response(readFileSync(p), {
    headers: { "content-type": extname(p) === ".jpg" ? "image/jpeg" : "image/webp", "cache-control": versioned ? "private, max-age=31536000, immutable" : "private, no-cache" },
  });
});
