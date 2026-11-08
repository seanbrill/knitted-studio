import { z } from "zod";
import { createDesign, listDesigns } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(listDesigns(store(), (await params).id)));

const Create = z.object({ name: z.string().max(120), start: z.enum(["brand", "blank"]).optional() });
export const POST = route(async (req: Request, { params }: Ctx) => {
  const b = await body(req, Create);
  return ok(createDesign(store(), (await params).id, b), 201);
});
