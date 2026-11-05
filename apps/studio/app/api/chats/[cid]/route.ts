import { cancelAgent } from "@knitted/agent";
import { chatSummary, deleteChat } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";
import { chatView } from "@/lib/chats";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ cid: string }> };

/** A chat and its turns: each is the run that answered a message, with the message in its input. */
export const GET = route(async (_: Request, { params }: Ctx) => {
  const s = store();
  const c = chatSummary(s, (await params).cid);
  return ok({ ...chatView(s, c), turns: c.jobIds.flatMap((id) => { try { return [s.getJob(id)]; } catch { return []; } }) });
});

/** The conversation goes, and a run still answering is stopped. What the model made stays. */
export const DELETE = route(async (_: Request, { params }: Ctx) => {
  const s = store();
  const c = chatSummary(s, (await params).cid);
  const last = c.jobIds.at(-1);
  if (last) cancelAgent(last);
  deleteChat(s, c.id);
  return ok({ ok: true });
});
