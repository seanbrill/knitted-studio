import { deleteKnit, getKnit } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ kid: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(getKnit(store(), (await params).kid)));
export const DELETE = route(async (_: Request, { params }: Ctx) => { await deleteKnit(store(), (await params).kid); return ok({ ok: true }); });
