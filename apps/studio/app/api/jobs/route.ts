import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
/** Jobs in every project: `kind=knit`, `active=1` for what is running or waiting, `project=` for one project. */
export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  return ok(store().listJobs({ kind: q.get("kind") ?? undefined, active: q.get("active") === "1", projectId: q.get("project") ?? undefined, limit: 100 }));
});
