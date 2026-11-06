import { readFileSync } from "node:fs";
import { getYarn, pdfPagePath } from "@knitted/core/node";
import { fail, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** One page of a PDF as a picture: `?n=` the page, from 1, and `?px=` about how big. */
export const GET = route(async (req: Request, { params }: { params: Promise<{ yid: string }> }) => {
  const s = store();
  const y = getYarn(s, (await params).yid);
  const q = new URL(req.url).searchParams;
  if (y.kind !== "pdf") return fail(400, "validation", `${y.name} is not a PDF, so it has no pages.`);
  const p = await pdfPagePath(s, y, Number(q.get("n") ?? 1), Number(q.get("px") ?? 1600) || 1600);
  return new Response(readFileSync(p), { headers: { "content-type": "image/webp", "cache-control": q.has("v") ? "private, max-age=31536000, immutable" : "private, no-cache" } });
});
