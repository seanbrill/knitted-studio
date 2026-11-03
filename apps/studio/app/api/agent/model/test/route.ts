import { getSecret } from "@knitted/core/node";
import { fail, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** One tiny request, so someone learns the key works before they rely on it. */
export const POST = route(async () => {
  const s = store();
  const key = await getSecret("anthropic", s.paths.root);
  if (!key) return fail(400, "no-key", "Add your Anthropic key first.");
  const { model } = s.getSetting("model", { model: undefined as string | undefined });
  const r = await fetch(`${process.env.KNITTED_ANTHROPIC_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: model ?? "claude-sonnet-5-5", max_tokens: 8, messages: [{ role: "user", content: "Say ok." }] }),
  }).catch(() => null);
  if (!r) return fail(502, "offline", "Could not reach Anthropic. Check your internet connection.");
  if (r.status === 401) return fail(400, "bad-key", "Anthropic did not accept that key. Check it was copied whole.");
  if (r.status === 429) return fail(429, "rate", "Anthropic says slow down. Try again in a minute.");
  if (!r.ok) return fail(502, "model", `Anthropic answered with an error (${r.status}).`);
  return ok({ ok: true });
});
