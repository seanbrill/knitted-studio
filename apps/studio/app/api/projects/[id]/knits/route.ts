import { changedSince, listKnits, withVersions } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
/** Each knit once, as the file shown for it, with its versions and formats; `?every=1`, every file. */
export const GET = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const q = new URL(req.url).searchParams;
  const every = q.get("every") === "1";
  const listed = listKnits(store(), (await params).id, { patternId: q.get("pattern") ?? undefined, batchId: q.get("batch") ?? undefined, every, limit: 5000 });
  const knits = withVersions(store(), listed);
  const stale = changedSince(store(), knits);
  return ok(knits.map((k) => (stale.has(k.id) ? { ...k, patternChangedSince: true } : k)));
});
