import { z } from "zod";
import { createDesign, designMeta, listDesigns } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Without their code: the cards show a picture of each, not the sheet.
export const GET = route(async (_: Request, { params }: Ctx) => { const s = store(); return ok(listDesigns(s, (await params).id).map((d) => designMeta(s, d))); });

const Create = z.object({ name: z.string().max(120), start: z.enum(["brand", "blank"]).optional() });
export const POST = route(async (req: Request, { params }: Ctx) => {
  const b = await body(req, Create);
  const s = store();
  return ok(designMeta(s, createDesign(s, (await params).id, b)), 201);
});
