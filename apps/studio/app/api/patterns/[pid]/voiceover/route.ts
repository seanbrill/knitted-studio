import { z } from "zod";
import { startVoiceJob } from "@knitted/engine";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

const Body = z.object({
  lines: z.array(z.string().max(4000)).min(1).max(30), voice: z.string().max(120).optional(), speed: z.number().min(0.5).max(2).optional(),
  startMs: z.number().min(0).max(600_000).optional(), gapMs: z.number().min(0).max(5000).optional(), captions: z.boolean().optional(),
});

/** Start a voiceover job. It returns at once; the job reports each line as it is spoken. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ pid: string }> }) => {
  const b = await body(req, Body);
  const s = store();
  const { pid } = await params;
  return ok(startVoiceJob(s, { projectId: s.getPattern(pid).projectId, patternId: pid, ...b }), 202);
});
