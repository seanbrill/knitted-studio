import { readFile } from "node:fs/promises";
import { z } from "zod";
import { activeVoice } from "@knitted/engine";
import { speak } from "@knitted/voice";
import { body, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Say one sentence with the configured voice, so someone can hear it before committing a script to it. */
export const POST = route(async (req: Request) => {
  const b = await body(req, z.object({ text: z.string().max(300).default("Make it knitted."), voice: z.string().optional() }));
  const s = store();
  const { settings, provider } = await activeVoice(s);
  const r = await speak(provider, { text: b.text, voice: b.voice ?? settings.voice, speed: settings.speed ?? 1, cacheDir: s.paths.cacheDir });
  return new Response(await readFile(r.file), { headers: { "content-type": "audio/wav", "x-duration-ms": String(r.durationMs), "cache-control": "no-store" } });
});
