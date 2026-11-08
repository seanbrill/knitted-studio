import { postInsights } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** How posts did, and what the person's own posts say works: for one project (?projectId=), or all. */
export const GET = route(async (req: Request) => {
  const projectId = new URL(req.url).searchParams.get("projectId") || undefined;
  if (projectId) store().getProject(projectId);
  return ok(postInsights(store(), { projectId }));
});
