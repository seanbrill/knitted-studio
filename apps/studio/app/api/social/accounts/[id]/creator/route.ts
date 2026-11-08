import { getAccount } from "@knitted/core/node";
import { ADAPTERS, SocialError, freshTokens, makeHttp } from "@knitted/social";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** TikTok's choices for this account, asked each time a post is made, as TikTok asks apps to. */
export const GET = route(async (_: Request, { params }: Ctx) => {
  const s = store();
  const a = getAccount(s, (await params).id);
  if (a.platform !== "tiktok") throw new SocialError("Only TikTok has these choices.");
  const http = makeHttp();
  return ok(await ADAPTERS.tiktok.creator(http, await freshTokens(s, a.id, http)));
});
