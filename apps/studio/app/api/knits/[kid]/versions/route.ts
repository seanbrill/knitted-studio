import { chooseKnit, knitVersions } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ kid: string }> };

/** A knit's versions, oldest first, each with its files, the one shown first. */
export const GET = route(async (_: Request, { params }: Ctx) => ok(knitVersions(store(), (await params).kid)));
/** Show this file for its knit: its version becomes the current one, and it the file shown and posted. */
export const POST = route(async (_: Request, { params }: Ctx) => ok(chooseKnit(store(), (await params).kid)));
