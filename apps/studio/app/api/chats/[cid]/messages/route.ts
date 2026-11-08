import { z } from "zod";
import { startAgentJob } from "@knitted/agent";
import { chatSummary } from "@knitted/core/node";
import { body, fail, ok, route, store } from "@/lib/server";
import { chatView, modelRun, needsKey } from "@/lib/chats";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ cid: string }> };

/**
 * The next message in a chat. The model gets the whole conversation with it, as it was.
 * `patternId`: the pattern open where it was sent, in the editor. A chat goes on wherever the
 * person takes it in its project (a chat about the whole studio, anywhere), and a message is
 * about that pattern. Without one, it is about the pattern the chat is on (chatView).
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const b = await body(req, z.object({ prompt: z.string().trim().min(1).max(4000), mode: z.enum(["edit", "suggest"]).default("edit"), patternId: z.string().optional(), model: z.string().max(80).optional() }));
  const s = store();
  const id = (await params).cid;
  const missing = await needsKey(s);
  if (missing) return missing;
  // One answer at a time: the next turn is sent with the whole of the one before. Read
  // after the last wait, so two messages sent together cannot both start.
  const c = chatSummary(s, id);
  const view = chatView(s, c);
  if (view.running) return fail(409, "busy", "Your model is still answering. Wait for it, or press Stop.");
  if (b.patternId && c.projectId && s.getPattern(b.patternId).projectId !== c.projectId) {
    return fail(400, "elsewhere", `This chat is about ${view.project?.name ?? "another project"}. Start a new chat to ask about this pattern.`);
  }
  return ok(startAgentJob(s, { ...modelRun(s, b.model), chatId: c.id, patternId: b.patternId ?? view.pattern?.id, prompt: b.prompt, mode: b.mode }), 202);
});
