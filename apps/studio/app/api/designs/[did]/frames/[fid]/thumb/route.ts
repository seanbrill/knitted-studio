import { designThumb } from "@knitted/engine";
import { fail, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * A frame as a small picture, for the board to show while it is small on screen. Asked for with
 * ?v=<the frame as drawn and the brand>, so it is kept by the window until one of those changes.
 */
export const GET = route(async (req: Request, { params }: { params: Promise<{ did: string; fid: string }> }) => {
  const { did, fid } = await params;
  try {
    const { webp, height } = await designThumb(store(), did, fid);
    const versioned = new URL(req.url).searchParams.has("v");
    return new Response(new Uint8Array(webp), { headers: { "content-type": "image/webp", "x-frame-height": String(height), "cache-control": versioned ? "private, max-age=31536000, immutable" : "private, no-cache" } });
  } catch (e) {
    if ((e as { kind?: string }).kind === "renderer_unavailable") return fail(503, "renderer_unavailable", (e as Error).message);
    throw e;
  }
});
