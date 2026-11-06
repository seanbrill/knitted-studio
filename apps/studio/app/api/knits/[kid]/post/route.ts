import { z } from "zod";
import { AgentError } from "@knitted/agent";
import { writePost } from "@knitted/agent/post";
import { getSecret, setKnitPost } from "@knitted/core/node";
import { body, fail, ok, route, store } from "@/lib/server";
import { modelRun } from "@/lib/chats";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ kid: string }> };

/** Have the person's model write the knit's caption, hashtags and track: again, or with `ask`, what to change. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { ask } = await body(req, z.object({ ask: z.string().max(2000).optional() }).strict());
  const s = store();
  const { model, baseUrl } = modelRun(s);
  try {
    return ok(await writePost(s, (await params).kid, { ask, model, baseUrl, apiKey: await getSecret("anthropic", s.paths.root), signal: req.signal }));
  } catch (e) {
    if (e instanceof AgentError) return fail(e.kind === "config" ? 400 : 502, e.kind, e.message);
    throw e;
  }
});

/** The person's own changes to it. */
export const PUT = route(async (req: Request, { params }: Ctx) => {
  const b = await body(req, z.object({ caption: z.string().max(5000).optional(), hashtags: z.array(z.string().max(100)).max(40).optional(), audioId: z.string().max(40).nullable().optional() }).strict());
  return ok(setKnitPost(store(), (await params).kid, { ...b, by: "human" }));
});
