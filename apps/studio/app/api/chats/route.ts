import { z } from "zod";
import { startAgentJob, startChat } from "@knitted/agent";
import { chatSummary, listChats } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";
import { chatView, modelRun, needsKey } from "@/lib/chats";

export const dynamic = "force-dynamic";

/** The chats, newest first. `?pattern=pt_...` for the ones started on a pattern, `?project=` for a project's. */
export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const s = store();
  return ok(listChats(s, { patternId: q.get("pattern") || undefined, projectId: q.get("project") || undefined }).map((c) => chatView(s, c)));
});

/** A new chat, with its first message on its way to the model. Progress and the answer are read from the run, a job. */
export const POST = route(async (req: Request) => {
  const b = await body(req, z.object({ projectId: z.string().nullable().optional(), patternId: z.string().optional(), prompt: z.string().trim().min(1).max(4000), mode: z.enum(["edit", "suggest"]).default("edit"), model: z.string().max(80).optional() }));
  const s = store();
  const missing = await needsKey(s);
  if (missing) return missing;
  const projectId = b.patternId ? s.getPattern(b.patternId).projectId : b.projectId ? s.getProject(b.projectId).id : null;
  const chat = startChat(s, { projectId, patternId: b.patternId ?? null, prompt: b.prompt });
  const job = startAgentJob(s, { ...modelRun(s, b.model), chatId: chat.id, patternId: b.patternId, prompt: b.prompt, mode: b.mode });
  return ok({ chat: chatView(s, chatSummary(s, chat.id)), job }, 202);
});
