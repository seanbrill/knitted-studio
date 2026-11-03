import { colorsFromYarn } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
export const GET = route(async (_: Request, { params }: { params: Promise<{ yid: string }> }) => ok(colorsFromYarn(store(), (await params).yid)));
