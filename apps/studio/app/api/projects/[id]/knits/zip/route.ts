import { basename } from "node:path";
import { getKnit, knitPath, listKnits, zipStream } from "@knitted/core/node";
import { fail, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** `?ids=a,b` or `?batch=bt_...` or neither (everything). Streams, so a big batch never sits in memory. */
export const GET = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = store(); const { id } = await params;
  const q = new URL(req.url).searchParams;
  const ids = q.get("ids")?.split(",").filter(Boolean);
  const knits = ids ? ids.map((k) => getKnit(s, k)).filter((k) => k.projectId === id) : listKnits(s, id, { batchId: q.get("batch") ?? undefined });
  if (!knits.length) return fail(404, "not_found", "There is nothing to download yet. Knit something first.");
  const used = new Set<string>();
  const entries = knits.map((k) => { let name = basename(k.file); while (used.has(name)) name = `${used.size}-${name}`; used.add(name); return { name, path: knitPath(s, k) }; });
  return new Response(zipStream(entries) as unknown as BodyInit, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${s.getProject(id).name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-knits.zip"` } });
});
