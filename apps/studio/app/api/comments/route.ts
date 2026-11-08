import { z } from "zod";
import { addComment, listComments, openCommentCounts } from "@knitted/core/node";
import { body, fail, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * The comments on a knit (?knit=), a design sheet (?design=, and ?frame= for one frame), or a whole
 * project (?project=), oldest first. ?open=1 for those not resolved; ?counts=1 with ?project= for
 * how many are open on each knit and sheet, for the badges on their cards.
 */
export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const s = store();
  const project = q.get("project") || undefined;
  if (q.get("counts")) return project ? ok(openCommentCounts(s, project)) : fail(400, "bad_request", "Counts are for a project: give ?project=.");
  return ok(listComments(s, { knitId: q.get("knit") || undefined, designId: q.get("design") || undefined, frameId: q.get("frame") || undefined, projectId: project, open: q.get("open") === "1" }));
});

const New = z.object({
  knitId: z.string().optional(), designId: z.string().optional(), frameId: z.string().optional(),
  x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), timeMs: z.number().min(0).optional(),
  text: z.string().trim().min(1).max(4000),
});
/** A new comment, the person's, pinned where they put it. */
export const POST = route(async (req: Request) => ok(addComment(store(), await body(req, New), "human"), 201));
