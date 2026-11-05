import { z } from "zod";
import { startAgentJob } from "@knitted/agent";
import { chatSummary } from "@knitted/core/node";
import { body, fail, ok, route, store } from "@/lib/server";
import { chatView, modelRun, needsKey } from "@/lib/chats";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ cid: string }> };

/** The next message in a chat. The model gets the whole conversation with it, as it was. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const b = await body(req, z.object({ prompt: z.string().trim().min(1).max(4000), mode: z.enum(["edit", "suggest"]).default("edit") }));
  const s = store();
  const id = (await params).cid;
  const missing = await needsKey(s);
  if (missing) return missing;
  // One answer at a time: the next turn is sent with the whole of the one before. Read
  // after the last wait, so two messages sent together cannot both start.
  const c = chatSummary(s, id);
  if (chatView(s, c).running) return fail(409, "busy", "Your model is still answering. Wait for it, or press Stop.");
  return ok(startAgentJob(s, { ...modelRun(s), chatId: c.id, patternId: c.patternId ?? undefined, prompt: b.prompt, mode: b.mode }), 202);
});
