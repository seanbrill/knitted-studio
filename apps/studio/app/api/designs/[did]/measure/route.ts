import { measureDesign } from "@knitted/engine";
import { fail, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** How tall the frames not measured yet are, drawn in knitted's browser all at once: what the board needs to lay the sheet out. */
export const POST = route(async (_: Request, { params }: { params: Promise<{ did: string }> }) => {
  try {
    return ok(await measureDesign(store(), (await params).did));
  } catch (e) {
    if ((e as { kind?: string }).kind === "renderer_unavailable") return fail(503, "renderer_unavailable", (e as Error).message);
    throw e;
  }
});
