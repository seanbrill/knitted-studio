import { z } from "zod";
import { deletePost, getPost, updatePost } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";
import { kick } from "@/lib/social";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(getPost(store(), (await params).id)));

const Change = z.object({
  caption: z.string().max(6000).optional(), title: z.string().max(200).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  at: z.string().max(40).nullable().optional(), draft: z.boolean().optional(),
  knitIds: z.array(z.string()).max(20).optional(),
}).strict();

/** Change a post still to go out: its words, its time, or whether it is a draft. `at` now posts it now. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const p = updatePost(store(), (await params).id, await body(req, Change));
  if (p.status === "scheduled") kick();
  return ok(p);
});

/** Remove it from knitted. One posted stays on the platform. */
export const DELETE = route(async (_: Request, { params }: Ctx) => { deletePost(store(), (await params).id); return ok({ ok: true }); });
