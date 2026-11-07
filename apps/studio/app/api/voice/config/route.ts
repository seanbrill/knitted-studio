import { z } from "zod";
import { deleteSecret, secretStatus, setSecret } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

const DEFAULTS = { provider: "system", voice: "default", speed: 1, baseUrl: "", model: "tts-1", style: "", options: {} as Record<string, unknown> };
async function view() {
  const s = store();
  return { ...DEFAULTS, ...s.getSetting("voice", DEFAULTS), key: await secretStatus("voice_openai", s.paths.root) };
}

// The key itself is never returned: only whether one exists and where it lives.
export const GET = route(async () => ok(await view()));

const Put = z.object({
  provider: z.enum(["system", "openai", "piper"]).optional(), voice: z.string().max(120).optional(), speed: z.number().min(0.5).max(2).optional(),
  baseUrl: z.string().max(300).optional(), model: z.string().max(80).optional(), piperBinary: z.string().max(500).optional(), piperModel: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional(), clearKey: z.boolean().optional(),
  // How to say it, in words (sent as `instructions`), and anything else the server takes, as it is.
  style: z.string().max(1000).optional(), options: z.record(z.string(), z.unknown()).optional(),
});
export const PUT = route(async (req: Request) => {
  const b = await body(req, Put);
  const s = store();
  const { apiKey, clearKey, ...rest } = b;
  if (rest.baseUrl && !/^https?:\/\//.test(rest.baseUrl)) return Response.json({ error: { kind: "validation", message: "The voice server address has to start with http:// or https://." } }, { status: 400 });
  s.setSetting("voice", { ...DEFAULTS, ...s.getSetting("voice", DEFAULTS), ...rest });
  if (clearKey) await deleteSecret("voice_openai", s.paths.root);
  if (apiKey) await setSecret("voice_openai", apiKey, s.paths.root);
  return ok(await view());
});
