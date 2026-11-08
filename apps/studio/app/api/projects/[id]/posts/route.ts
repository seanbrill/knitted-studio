import { z } from "zod";
import { PLATFORMS, PLATFORM_IDS, type Platform } from "@knitted/core";
import { ValidationError, createPost, getAccount, listPosts, validatePost } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";
import { kick } from "@/lib/social";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(listPosts(store(), { projectId: (await params).id })));

const byPlatform = <T extends z.ZodTypeAny>(t: T) => z.object(Object.fromEntries(PLATFORM_IDS.map((p) => [p, t.optional()])) as Record<Platform, z.ZodOptional<T>>).partial();
const New = z.object({
  accountIds: z.array(z.string()).min(1, "Pick at least one account to post to.").max(12),
  knitIds: z.array(z.string()).max(20),
  caption: z.string().max(6000),
  title: z.string().max(200).optional(),
  captions: byPlatform(z.string().max(6000)).optional(),
  options: byPlatform(z.record(z.string(), z.unknown())).optional(),
  at: z.string().max(40).nullable().optional(),
  draft: z.boolean().optional(),
}).strict();

/**
 * A post to each account picked. All are checked before any is made, so one a platform
 * would refuse stops the lot, saying which and why, rather than leaving half of them made.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const projectId = (await params).id;
  const b = await body(req, New);
  const s = store();
  const each = b.accountIds.map((accountId) => {
    const platform = getAccount(s, accountId).platform;
    return { projectId, accountId, knitIds: b.knitIds, caption: b.captions?.[platform] ?? b.caption, title: b.title, options: b.options?.[platform] ?? {}, at: b.at ?? null, draft: b.draft };
  });
  for (const p of each) {
    try { validatePost(s, p, !p.draft); }
    catch (e) { const a = getAccount(s, p.accountId); throw new ValidationError(`${PLATFORMS[a.platform].name}${a.handle ? ` (@${a.handle})` : ""}: ${(e as Error).message}`); }
  }
  const made = each.map((p) => createPost(s, p));
  if (!b.draft) kick();
  return ok(made, 201);
});
