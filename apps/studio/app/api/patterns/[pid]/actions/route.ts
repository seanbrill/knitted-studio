import { z } from "zod";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
const Action = z.object({ action: z.enum(["duplicate"]) });

export const POST = route(async (req: Request, { params }: { params: Promise<{ pid: string }> }) => {
  await body(req, Action);
  return ok(store().duplicatePattern((await params).pid), 201);
});
