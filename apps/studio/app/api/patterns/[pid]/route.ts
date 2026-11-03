import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ pid: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(store().getPattern((await params).pid)));
export const DELETE = route(async (_: Request, { params }: Ctx) => { store().deletePattern((await params).pid); return ok({ ok: true }); });
