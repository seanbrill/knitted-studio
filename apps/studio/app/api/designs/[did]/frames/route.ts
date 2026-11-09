import { getFrameCode } from "@knitted/core/node";
import { fail, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Some frames' code, for the board to draw them live: ?ids=f1,f7. */
export const GET = route(async (req: Request, { params }: { params: Promise<{ did: string }> }) => {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!ids.length || ids.length > 200) return fail(400, "bad_request", "Ask for 1 to 200 frames, as ids=f1,f2.");
  return ok(getFrameCode(store(), (await params).did, ids));
});
