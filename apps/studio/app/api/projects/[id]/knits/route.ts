import { listKnits } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
export const GET = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const q = new URL(req.url).searchParams;
  return ok(listKnits(store(), (await params).id, { patternId: q.get("pattern") ?? undefined, batchId: q.get("batch") ?? undefined }));
});
