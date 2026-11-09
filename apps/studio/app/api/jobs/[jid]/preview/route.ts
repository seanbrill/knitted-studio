import { readFile } from "node:fs/promises";
import { jobPreviewPath } from "@knitted/core/node";
import { fail, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

// The file a knit is drawing now, as its poster: the queue shows it while the frames are drawn
// (job.progress.preview says which file it is). Gone once the knit is done.
export const GET = route(async (_: Request, { params }: { params: Promise<{ jid: string }> }) => {
  const s = store();
  const job = s.getJob((await params).jid);
  if (!job.projectId) return fail(404, "not_found", "This job draws nothing.");
  const picture = await readFile(jobPreviewPath(s, job.projectId, job.id)).catch(() => null);
  if (!picture) return fail(404, "not_found", "Nothing is being drawn for this job now.");
  return new Response(new Uint8Array(picture), { headers: { "content-type": "image/jpeg", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
});
