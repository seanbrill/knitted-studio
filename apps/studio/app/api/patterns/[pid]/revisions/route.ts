import { z } from "zod";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ pid: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(store().revisions((await params).pid)));
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { revisionId } = await body(req, z.object({ revisionId: z.string() }));
  return ok(store().restoreRevision((await params).pid, revisionId));
});
