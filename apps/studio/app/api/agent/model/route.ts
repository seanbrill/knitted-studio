import { z } from "zod";
import { CHOICES, DEFAULT_CHOICE } from "@knitted/agent";
import { deleteSecret, secretStatus, setSecret } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

const DEFAULTS = { model: DEFAULT_CHOICE, maxTurns: 25, maxKnits: 24 };
async function view() {
  const s = store();
  return { ...DEFAULTS, ...s.getSetting("model", DEFAULTS), models: CHOICES, key: await secretStatus("anthropic", s.paths.root) };
}

// The key itself is never returned: only whether one exists and where it lives.
export const GET = route(async () => ok(await view()));

const Put = z.object({ model: z.enum(CHOICES.map((c) => c.id) as [string, ...string[]]).optional(), maxTurns: z.number().int().min(1).max(100).optional(), maxKnits: z.number().int().min(0).max(100).optional(), apiKey: z.string().max(500).optional(), clearKey: z.boolean().optional() });
export const PUT = route(async (req: Request) => {
  const { apiKey, clearKey, ...rest } = await body(req, Put);
  const s = store();
  s.setSetting("model", { ...DEFAULTS, ...s.getSetting("model", DEFAULTS), ...rest });
  if (clearKey) await deleteSecret("anthropic", s.paths.root);
  if (apiKey) await setSecret("anthropic", apiKey.trim(), s.paths.root);
  return ok(await view());
});
