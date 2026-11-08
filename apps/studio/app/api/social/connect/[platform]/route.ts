import { isPlatform } from "@knitted/core/node";
import { startConnect } from "@knitted/social";
import { fail, ok, route, store } from "@/lib/server";
import { portOf } from "@/lib/social";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ platform: string }> };

/** Where to send the person to sign in. The studio opens it in their own browser. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const platform = (await params).platform;
  if (!isPlatform(platform)) return fail(404, "not_found", "knitted does not post there.");
  const { url } = await startConnect(store(), platform, { port: portOf(req) });
  return ok({ url });
});
