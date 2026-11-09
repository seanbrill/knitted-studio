import { readFile } from "node:fs/promises";
import { ensureKnitPoster, getKnit } from "@knitted/core/node";
import { fail, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

// A video knit's poster: the moment its pattern shows whole. Drawn with the video; a video
// knitted before that gets one from the video the first time it is asked for, then keeps it.
// None (a picture, no ffmpeg): 404, and the card shows the video's first frame instead.
export const GET = route(async (_: Request, { params }: { params: Promise<{ kid: string }> }) => {
  const s = store();
  const file = await ensureKnitPoster(s, getKnit(s, (await params).kid));
  if (!file) return fail(404, "not_found", "This knit has no poster.");
  // A knit's file never changes (knitted again, it is a new knit), so neither does its poster.
  return new Response(new Uint8Array(await readFile(file)), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
});
