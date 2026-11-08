import { searchStock } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

// Every source that has the kind, at once. One with no key, or one that fails, says so.
export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind") as "image" | "video" | "audio";
  return ok(await searchStock(store(), { q: q.get("q") ?? "", kind, page: Number(q.get("page") ?? 1) || 1 }));
});
