import { z } from "zod";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const Action = z.object({ action: z.enum(["duplicate", "archive", "restore", "undelete"]), name: z.string().optional() });

export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const b = await body(req, Action);
  const s = store();
  if (b.action === "duplicate") return ok(s.duplicateProject(id, { name: b.name }), 201);
  if (b.action === "archive") s.archiveProject(id);
  if (b.action === "restore") s.restoreProject(id);
  if (b.action === "undelete") s.undeleteProject(id);
  return ok(s.getProject(id));
});
