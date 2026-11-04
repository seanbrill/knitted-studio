import { z } from "zod";
import { SizeSchema } from "@knitted/core";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(store().listPatterns((await params).id)));

const Create = z.object({ name: z.string().optional(), size: SizeSchema.optional(), folder: z.string().max(400).optional() });
export const POST = route(async (req: Request, { params }: Ctx) => ok(store().createPattern((await params).id, await body(req, Create)), 201));
