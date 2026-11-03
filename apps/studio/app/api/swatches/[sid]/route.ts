import { z } from "zod";
import { SwatchPatchSchema } from "@knitted/core";
import { copySwatchToProject, deleteSwatch, duplicateSwatch, getSwatch, setActiveSwatch, updateSwatch } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ sid: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(getSwatch(store(), (await params).sid)));
export const PATCH = route(async (req: Request, { params }: Ctx) => ok(updateSwatch(store(), (await params).sid, (await body(req, SwatchPatchSchema)) as never)));
export const DELETE = route(async (_: Request, { params }: Ctx) => { deleteSwatch(store(), (await params).sid); return ok({ ok: true }); });

const Action = z.object({ action: z.enum(["activate", "duplicate", "copyTo"]), projectId: z.string().optional() });
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { sid } = await params;
  const b = await body(req, Action);
  const s = store();
  if (b.action === "duplicate") return ok(duplicateSwatch(s, sid), 201);
  if (b.action === "copyTo") return ok(copySwatchToProject(s, sid, b.projectId ?? ""), 201);
  const sw = getSwatch(s, sid);
  setActiveSwatch(s, sw.projectId, sid);
  return ok(sw);
});
