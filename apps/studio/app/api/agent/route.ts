import { z } from "zod";
import { startAgentJob } from "@knitted/agent";
import { body, ok, route, store } from "@/lib/server";
import { modelRun, needsKey } from "@/lib/chats";

export const dynamic = "force-dynamic";

/** Start a model run on a pattern, outside any chat. Progress and the answer are read from the job, like a knit. */
export const POST = route(async (req: Request) => {
  const b = await body(req, z.object({ projectId: z.string(), patternId: z.string().optional(), prompt: z.string().min(1).max(4000), mode: z.enum(["edit", "suggest"]).default("edit"), model: z.string().max(80).optional() }));
  const s = store();
  const missing = await needsKey(s);
  if (missing) return missing;
  return ok(startAgentJob(s, { ...b, ...modelRun(s, b.model) }), 202);
});
