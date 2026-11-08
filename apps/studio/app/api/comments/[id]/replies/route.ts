import { z } from "zod";
import { replyComment } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** The person's reply in a thread. `resolve`: true resolves it with the reply, false opens it again. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const b = await body(req, z.object({ text: z.string().trim().min(1).max(4000), resolve: z.boolean().optional() }));
  return ok(replyComment(store(), (await params).id, b, "human"), 201);
});
