import { z } from "zod";
import { SwatchPatchSchema } from "@knitted/core";
import { createSwatch, listSwatches } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(listSwatches(store(), (await params).id)));

const Create = z.object({ template: z.string().optional(), data: SwatchPatchSchema.optional(), activate: z.boolean().optional(), folder: z.string().max(400).optional() });
export const POST = route(async (req: Request, { params }: Ctx) => {
  const b = await body(req, Create);
  return ok(createSwatch(store(), (await params).id, { template: b.template, data: b.data as never, activate: b.activate, folder: b.folder }), 201);
});
