import { z } from "zod";
import { deletePart, duplicatePart, editPart, exportPart, getPart, partUsage, setPartScope, updatePart } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ pid: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => { const s = store(); const { pid } = await params; return ok({ part: getPart(s, pid), usage: partUsage(s, pid) }); });
export const PATCH = route(async (req: Request, { params }: Ctx) => ok(updatePart(store(), (await params).pid, (await body(req, z.record(z.string(), z.unknown()))) as never)));
export const DELETE = route(async (_: Request, { params }: Ctx) => ok(deletePart(store(), (await params).pid)));

// `folder`, for duplicate: where the copy goes. Left out, it goes next to the original.
// `edit`: the pattern the Part is edited through in the editor, in `projectId`.
const Action = z.object({ action: z.enum(["duplicate", "to-library", "to-project", "export", "edit"]), projectId: z.string().optional(), folder: z.string().max(400).optional() });
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { pid } = await params;
  const b = await body(req, Action);
  const s = store();
  if (b.action === "duplicate") return ok(duplicatePart(s, pid, b.projectId ?? undefined, b.folder), 201);
  if (b.action === "to-library") return ok(setPartScope(s, pid, null));
  if (b.action === "to-project") return ok(setPartScope(s, pid, b.projectId ?? null));
  if (b.action === "edit") return ok(editPart(s, pid, b.projectId ?? getPart(s, pid).projectId ?? ""));
  return ok(exportPart(s, pid));
});
