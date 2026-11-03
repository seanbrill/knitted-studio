import { z } from "zod";
import { createCopy } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const b = await body(req, z.object({ name: z.string().max(120), text: z.string().max(1_000_000) }));
  return ok(await createCopy(store(), (await params).id, b), 201);
});
