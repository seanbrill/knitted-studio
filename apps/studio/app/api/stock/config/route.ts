import { z } from "zod";
import { STOCK_SOURCES, type StockProvider } from "@knitted/core";
import { deleteSecret, secretStatus, setSecret, stockKey } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

// Each source, and whether its key is saved and where. The key itself is never returned.
async function view() {
  const root = store().paths.root;
  return { sources: await Promise.all(Object.values(STOCK_SOURCES).map(async (s) => ({ ...s, key: s.keyUrl ? await secretStatus(stockKey(s.provider), root) : null }))) };
}

export const GET = route(async () => ok(await view()));

const Put = z.object({ provider: z.enum(["pixabay", "pexels"]), apiKey: z.string().max(500).optional(), clearKey: z.boolean().optional() });
export const PUT = route(async (req: Request) => {
  const b = await body(req, Put);
  const root = store().paths.root;
  if (b.clearKey) await deleteSecret(stockKey(b.provider as StockProvider), root);
  if (b.apiKey) await setSecret(stockKey(b.provider as StockProvider), b.apiKey, root);
  return ok(await view());
});
