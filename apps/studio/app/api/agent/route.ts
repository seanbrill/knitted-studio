import { z } from "zod";
import { startAgentJob } from "@knitted/agent";
import { body, fail, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Start a model run on a pattern. Progress and the answer are read from the job, like a knit. */
export const POST = route(async (req: Request) => {
  const b = await body(req, z.object({ projectId: z.string(), patternId: z.string().optional(), prompt: z.string().min(1).max(4000), mode: z.enum(["edit", "suggest"]).default("edit") }));
  const s = store();
  const cfg = s.getSetting("model", { model: undefined as string | undefined, maxTurns: 25, maxKnits: 24 });
  const { secretStatus } = await import("@knitted/core/node");
  if (!(await secretStatus("anthropic", s.paths.root)).present) return fail(400, "no-key", "Add your Anthropic key in Settings, under Model, so your model can work on this pattern.");
  return ok(startAgentJob(s, { ...b, model: cfg.model, maxTurns: cfg.maxTurns, maxKnits: cfg.maxKnits, baseUrl: process.env.KNITTED_ANTHROPIC_URL || undefined }), 202);
});
