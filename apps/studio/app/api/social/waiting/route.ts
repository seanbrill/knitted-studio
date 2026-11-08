import { listPosts } from "@knitted/core/node";
import { socialConfig } from "@knitted/social";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * The posts that need knitted running to go out, for the desktop app to decide whether to
 * keep running when its window closes. A YouTube post already uploaded goes out without it.
 */
export const GET = route(async () => {
  const s = store();
  const waiting = listPosts(s, { status: ["scheduled", "posting"] }).filter((p) => !p.options.uploaded);
  const next = waiting.map((p) => p.scheduledAt).filter((t): t is string => !!t).sort()[0] ?? null;
  return ok({ waiting: waiting.length, next, stayOpen: socialConfig(s).stayOpen });
});
