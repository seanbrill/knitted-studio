import { z } from "zod";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(store().getProject((await params).id)));

const Patch = z.object({ name: z.string().optional(), description: z.string().optional(), swatchId: z.string().nullable().optional(), coverYarnId: z.string().nullable().optional() }).strict();
export const PATCH = route(async (req: Request, { params }: Ctx) => ok(store().updateProject((await params).id, await body(req, Patch))));

/** Soft delete: the client offers Undo, which calls the undelete action. */
export const DELETE = route(async (_: Request, { params }: Ctx) => { store().deleteProject((await params).id); return ok({ ok: true }); });
