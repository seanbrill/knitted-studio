import { cancelAgent } from "@knitted/agent";
import { cancelJob } from "@knitted/engine";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ jid: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(store().getJob((await params).jid)));
// A model's run is stopped by the agent that runs it; a knit or a voiceover, by the engine.
// The run says it was stopped itself, a moment later, as it ends.
export const DELETE = route(async (_: Request, { params }: Ctx) => {
  const s = store();
  const id = (await params).jid;
  if (s.getJob(id).kind === "agent") { cancelAgent(id); return ok(s.getJob(id)); }
  return ok(cancelJob(s, id));
});
