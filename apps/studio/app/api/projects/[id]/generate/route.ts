import { z } from "zod";
import { planGeneration, startGeneration } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

const Ask = z.object({
  kind: z.enum(["image", "video"]), prompt: z.string().max(4000), from: z.array(z.string().max(80)).max(6).optional(),
  count: z.number().int().min(1).max(4).optional(), aspect: z.enum(["1:1", "4:5", "9:16", "16:9", "3:2", "2:3"]).optional(),
  quality: z.enum(["draft", "good", "best"]).optional(), seconds: z.number().int().min(3).max(15).optional(), transparent: z.boolean().optional(),
  provider: z.enum(["openai", "google"]).optional(), model: z.string().max(80).optional(),
  name: z.string().max(100).optional(), folder: z.string().max(400).optional(), tags: z.array(z.string().max(60)).max(20).optional(),
  /** Only say what it would be and cost. */
  estimate: z.boolean().optional(),
});

// A photo or a video, made by the provider chosen in Settings, as a job: GET /api/jobs/<id> follows it.
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { estimate, ...b } = await body(req, Ask);
  const s = store();
  const projectId = (await params).id;
  s.getProject(projectId);
  if (estimate) return ok({ plan: await planGeneration(s, b) });
  const { job, plan } = await startGeneration(s, projectId, { ...b, actor: "human" });
  return ok({ job, plan }, 202);
});
