import { z } from "zod";
import { proposeFromWebsite } from "@knitted/core/node";
import { body, ok, route } from "@/lib/server";

export const dynamic = "force-dynamic";

// Returns a PROPOSAL and saves nothing: the user reviews it, then creates the swatch.
export const POST = route(async (req: Request) => ok(await proposeFromWebsite((await body(req, z.object({ url: z.string().max(2000) }))).url)));
