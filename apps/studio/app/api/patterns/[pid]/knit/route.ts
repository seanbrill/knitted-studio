import { z } from "zod";
import { SizeSchema } from "@knitted/core";
import { previewKnit, startKnitJob } from "@knitted/engine";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

const Params = z.object({
  sizes: z.array(SizeSchema).max(12).optional(),
  format: z.enum(["png", "jpeg", "webp", "mp4"]).optional(),
  scale: z.union([z.literal(1), z.literal(2)]).optional(),
  rows: z.array(z.record(z.string(), z.string().max(2000))).max(500).optional(),
  reuse: z.boolean().optional(),
});

/** Start a knit. Returns a job straight away; progress is read from the job. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ pid: string }> }) => {
  const { pid } = await params;
  const b = await body(req, z.object({ params: Params.default({}), dryRun: z.boolean().optional() }));
  const s = store();
  const pattern = s.getPattern(pid);
  if (b.dryRun) return ok({ units: previewKnit(s, { projectId: pattern.projectId, patternId: pid, params: b.params }) });
  return ok(startKnitJob(s, { projectId: pattern.projectId, patternId: pid, params: b.params }), 202);
});
