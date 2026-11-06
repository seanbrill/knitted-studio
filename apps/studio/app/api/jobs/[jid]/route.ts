import { cancelAgent } from "@knitted/agent";
import { cancelSync } from "@knitted/agent/profile";
import { cancelJob } from "@knitted/engine";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ jid: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(store().getJob((await params).jid)));
// A model's run, or a sync with a website, is stopped by the agent that runs it; a knit
// or a voiceover, by the engine.
// The run says it was stopped itself, a moment later, as it ends.
export const DELETE = route(async (_: Request, { params }: Ctx) => {
  const s = store();
  const id = (await params).jid;
  const kind = s.getJob(id).kind;
  if (kind === "agent") { cancelAgent(id); return ok(s.getJob(id)); }
  if (kind === "sync") { cancelSync(id); return ok(s.getJob(id)); }
  return ok(cancelJob(s, id));
});
