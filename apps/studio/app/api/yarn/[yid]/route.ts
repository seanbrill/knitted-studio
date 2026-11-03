import { z } from "zod";
import { deleteYarn, getYarn, undeleteYarn, updateYarn, yarnUsage } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ yid: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => {
  const { yid } = await params;
  const s = store();
  return ok({ yarn: getYarn(s, yid), usage: yarnUsage(s, yid) });
});

const Patch = z.object({ name: z.string().max(120).optional(), tags: z.array(z.string().max(40)).max(30).optional() }).strict();
export const PATCH = route(async (req: Request, { params }: Ctx) => ok(updateYarn(store(), (await params).yid, await body(req, Patch))));

export const DELETE = route(async (_: Request, { params }: Ctx) => { deleteYarn(store(), (await params).yid); return ok({ ok: true }); });

export const POST = route(async (req: Request, { params }: Ctx) => {
  await body(req, z.object({ action: z.literal("undelete") }));
  undeleteYarn(store(), (await params).yid);
  return ok(getYarn(store(), (await params).yid));
});
