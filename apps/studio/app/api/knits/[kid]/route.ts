import { z } from "zod";
import { deleteKnit, getKnit, markKnitsSeen, setKnitFavorite, setKnitTags } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ kid: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(getKnit(store(), (await params).kid)));
export const DELETE = route(async (_: Request, { params }: Ctx) => { await deleteKnit(store(), (await params).kid); return ok({ ok: true }); });
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { tags, seen, favorite } = await body(req, z.object({ tags: z.array(z.string().max(40)).max(30).optional(), seen: z.literal(true).optional(), favorite: z.boolean().optional() }).strict());
  const id = (await params).kid;
  if (seen) markKnitsSeen(store(), [id]);
  if (favorite !== undefined) setKnitFavorite(store(), [id], favorite);
  return ok(tags ? setKnitTags(store(), id, tags) : getKnit(store(), id));
});
