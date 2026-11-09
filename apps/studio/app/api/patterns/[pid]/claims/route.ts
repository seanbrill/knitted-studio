import { AgentError } from "@knitted/agent";
import { checkClaims } from "@knitted/agent/claims";
import { getSecret } from "@knitted/core/node";
import { fail, ok, route, store } from "@/lib/server";
import { modelRun } from "@/lib/chats";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ pid: string }> };

/** Have the person's model read the pattern's words beside the Brief, claim by claim (design sheet f47). */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const s = store();
  const { model, baseUrl } = modelRun(s);
  try {
    return ok(await checkClaims(s, (await params).pid, { model, baseUrl, apiKey: await getSecret("anthropic", s.paths.root), signal: req.signal }));
  } catch (e) {
    // No key, an empty Brief, or a spending limit reached: the person's to change. The rest is the model's end.
    if (e instanceof AgentError) return fail(["config", "nobrief", "limit"].includes(e.kind) ? 400 : 502, e.kind, e.message);
    throw e;
  }
});
