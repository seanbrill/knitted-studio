import { z } from "zod";
import { deleteComment, editComment, getComment, resolveComment } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** A thread, by its id or the id of a reply in it. */
export const GET = route(async (_: Request, { params }: Ctx) => ok(getComment(store(), (await params).id)));

/** What a comment of the person's says, or whether its thread is resolved. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const b = await body(req, z.object({ text: z.string().trim().min(1).max(4000).optional(), resolved: z.boolean().optional() }));
  const s = store(), id = (await params).id;
  let t = getComment(s, id);
  if (b.text != null) t = editComment(s, id, b.text, "human");
  if (b.resolved != null) t = resolveComment(s, id, b.resolved, "human");
  return ok(t);
});

/** A thread with its replies, or one reply. */
export const DELETE = route(async (_: Request, { params }: Ctx) => { deleteComment(store(), (await params).id); return ok({ ok: true }); });
