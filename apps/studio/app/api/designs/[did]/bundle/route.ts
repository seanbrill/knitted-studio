import { zipStream } from "@knitted/core/node";
import { designBundle } from "@knitted/engine";
import { fail, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Everything that goes with a design, zipped: the sheet and each section as pictures, every frame
 * as HTML and CSS, the fonts and pictures it uses, tokens.css and tokens.json, and a style guide.
 */
export const GET = route(async (_: Request, { params }: { params: Promise<{ did: string }> }) => {
  try {
    const { name, entries } = await designBundle(store(), (await params).did);
    return new Response(zipStream(entries), { headers: { "content-type": "application/zip", "cache-control": "no-store", "content-disposition": `attachment; filename="${name}"` } });
  } catch (e) {
    if ((e as { kind?: string }).kind === "renderer_unavailable") return fail(503, "renderer_unavailable", (e as Error).message);
    throw e;
  }
});
