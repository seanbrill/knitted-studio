import { importSwatch } from "@knitted/core/node";
import { ok, route, store, fail } from "@/lib/server";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  let file: unknown;
  try { file = await req.json(); } catch { return fail(400, "validation", "That file is not valid JSON."); }
  return ok(await importSwatch(store(), (await params).id, file), 201);
});
