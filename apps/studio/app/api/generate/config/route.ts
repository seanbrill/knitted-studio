import { z } from "zod";
import { GEN_SOURCES, type GenProvider } from "@knitted/core";
import { deleteSecret, genChoice, genKey, secretStatus, setGenChoice, setSecret } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

// Each provider, whether its key is saved and where, and which makes photos and video. Never the key.
async function view() {
  const s = store();
  return { sources: await Promise.all(Object.values(GEN_SOURCES).map(async (g) => ({ ...g, key: await secretStatus(genKey(g.provider), s.paths.root) }))), choice: genChoice(s) };
}

export const GET = route(async () => ok(await view()));

const Pick = z.object({ provider: z.enum(["openai", "google"]), model: z.string().max(80) }).nullable();
const Put = z.object({
  provider: z.enum(["openai", "google"]).optional(), apiKey: z.string().max(500).optional(), clearKey: z.boolean().optional(),
  choice: z.object({ image: Pick.optional(), video: Pick.optional() }).optional(),
});
export const PUT = route(async (req: Request) => {
  const b = await body(req, Put);
  const s = store();
  if (b.provider && b.clearKey) await deleteSecret(genKey(b.provider as GenProvider), s.paths.root);
  if (b.provider && b.apiKey) await setSecret(genKey(b.provider as GenProvider), b.apiKey.trim(), s.paths.root);
  if (b.choice) setGenChoice(s, b.choice);
  return ok(await view());
});
