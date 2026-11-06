import { z } from "zod";
import { cropToYarn } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

const Box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

/** A part of a picture or a PDF's page, kept as a new picture. The original is not changed. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ yid: string }> }) => {
  const b = await body(req, z.object({ box: Box, page: z.number().int().min(1).optional(), name: z.string().max(120).optional(), shelf: z.enum(["yarn", "reference"]).optional(), folder: z.string().max(400).optional() }));
  const r = await cropToYarn(store(), (await params).yid, b);
  return ok(r, r.existing ? 200 : 201);
});
