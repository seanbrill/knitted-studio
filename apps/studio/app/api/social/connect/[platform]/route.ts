import { z } from "zod";
import { isPlatform } from "@knitted/core/node";
import { startConnect } from "@knitted/social";
import { body, fail, ok, route, store } from "@/lib/server";
import { portOf } from "@/lib/social";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ platform: string }> };

/** Where to send the person to sign in. The studio opens it in their own browser. `as: "pages"`: through LinkedIn's app for company pages. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const platform = (await params).platform;
  if (!isPlatform(platform)) return fail(404, "not_found", "knitted does not post there.");
  const b = await body(req, z.object({ as: z.literal("pages").optional() }).strict());
  if (b.as && platform !== "linkedin") return fail(400, "validation", "Only LinkedIn has an app for company pages.");
  const { url } = await startConnect(store(), platform, { port: portOf(req), slot: b.as ?? null });
  return ok({ url });
});
