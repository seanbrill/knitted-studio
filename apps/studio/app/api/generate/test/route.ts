import { z } from "zod";
import { testGenKey } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

// Whether a key works, by asking the provider for its list of models: it makes nothing, and costs nothing.
export const POST = route(async (req: Request) => ok(await testGenKey(store(), (await body(req, z.object({ provider: z.enum(["openai", "google"]) }))).provider)));
