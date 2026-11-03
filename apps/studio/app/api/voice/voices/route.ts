import { activeVoice } from "@knitted/engine";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const { provider } = await activeVoice(store());
  const available = await provider.available();
  return ok({ provider: provider.id, label: provider.label, available, voices: available ? await provider.voices().catch(() => []) : [] });
});
