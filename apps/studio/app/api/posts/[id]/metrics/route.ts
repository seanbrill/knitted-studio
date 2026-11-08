import { checkOne } from "@knitted/social";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Ask a post's platform how it is doing now, rather than at its next time. */
export const POST = route(async (_: Request, { params }: Ctx) => ok(await checkOne(store(), (await params).id)));
