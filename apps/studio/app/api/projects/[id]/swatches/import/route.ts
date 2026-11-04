import { importSwatch } from "@knitted/core/node";
import { ok, route, store, fail } from "@/lib/server";

export const dynamic = "force-dynamic";

/** The body is the swatch file itself; `?folder=` is the folder in the Swatch tab it goes in. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  let file: unknown;
  try { file = await req.json(); } catch { return fail(400, "validation", "That file is not valid JSON."); }
  return ok(await importSwatch(store(), (await params).id, file, new URL(req.url).searchParams.get("folder") ?? undefined), 201);
});
