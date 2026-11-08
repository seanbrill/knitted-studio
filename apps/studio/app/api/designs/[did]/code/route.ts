import { zipStream } from "@knitted/core/node";
import { designCode } from "@knitted/engine";
import { route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * The design as HTML and CSS, a page per frame, with the brand's tokens, fonts and pictures, zipped.
 * ?section=<id> for one section.
 */
export const GET = route(async (req: Request, { params }: { params: Promise<{ did: string }> }) => {
  const sectionId = new URL(req.url).searchParams.get("section") ?? undefined;
  const { name, entries } = await designCode(store(), (await params).did, { sectionId });
  return new Response(zipStream(entries), { headers: { "content-type": "application/zip", "cache-control": "no-store", "content-disposition": `attachment; filename="${name}"` } });
});
