import { z } from "zod";
import { StitchSchema } from "@knitted/core";
import { createPart, importPart, listParts } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(listParts(store(), (await params).id)));

const Slot = z.object({ name: z.string().max(41), kind: z.enum(["text", "image"]), default: z.string().max(2000).optional(), locked: z.boolean() });
const Create = z.object({
  name: z.string().max(120), description: z.string().max(400).optional(), category: z.enum(["text", "media", "motion", "frame", "cta", "other"]).optional(),
  kind: z.enum(["stitches", "code"]).optional(), stitches: z.array(StitchSchema).max(60).optional(), html: z.string().max(60_000).optional(), css: z.string().max(60_000).optional(),
  slots: z.array(Slot).max(24).optional(), aspect: z.number().optional(), durationMs: z.number().optional(), scope: z.enum(["project", "library"]).optional(),
  file: z.unknown().optional(), folder: z.string().max(400).optional(),
});
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const b = await body(req, Create);
  const target = b.scope === "library" ? null : id;
  if (b.file) return ok(importPart(store(), target, b.file, b.folder), 201);
  const { scope: _s, file: _f, ...input } = b; void _s; void _f;
  return ok(createPart(store(), target, input as never), 201);
});
