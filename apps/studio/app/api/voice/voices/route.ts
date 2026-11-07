import { activeVoice } from "@knitted/engine";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const { provider } = await activeVoice(store());
  const available = await provider.available();
  const models = available && "models" in provider ? await (provider as { models: () => Promise<{ id: string }[]> }).models().catch(() => []) : [];
  return ok({ provider: provider.id, label: provider.label, available, voices: available ? await provider.voices().catch(() => []) : [], models });
});
