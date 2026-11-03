import { cancelJob } from "@knitted/engine";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ jid: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(store().getJob((await params).jid)));
export const DELETE = route(async (_: Request, { params }: Ctx) => ok(cancelJob(store(), (await params).jid)));
