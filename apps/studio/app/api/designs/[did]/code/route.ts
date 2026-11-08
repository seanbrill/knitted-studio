import { zipStream } from "@knitted/core/node";
import { designCode } from "@knitted/engine";
import { route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** The design as HTML and CSS, a page per frame, with the brand's tokens, fonts and pictures, zipped. */
export const GET = route(async (_: Request, { params }: { params: Promise<{ did: string }> }) => {
  const { name, entries } = await designCode(store(), (await params).did);
  return new Response(zipStream(entries), { headers: { "content-type": "application/zip", "cache-control": "no-store", "content-disposition": `attachment; filename="${name}"` } });
});
