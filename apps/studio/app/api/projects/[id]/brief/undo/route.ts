import { undoProfile } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Back to the profile from before the last build or model change. */
export const POST = route(async (_: Request, { params }: { params: Promise<{ id: string }> }) => ok(undoProfile(store(), (await params).id)));
