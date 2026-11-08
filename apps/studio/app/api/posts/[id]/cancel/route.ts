import { cancelScheduled } from "@knitted/social";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Stop a post going out. One already on YouTube, waiting for its time, is taken off YouTube. */
export const POST = route(async (_: Request, { params }: Ctx) => ok(await cancelScheduled(store(), (await params).id)));
