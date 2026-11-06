import { z } from "zod";
import { getBrief, saveProfile, setBriefNotes } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(getBrief(store(), (await params).id)));

/** The person's own profile, or their edit of one, and their notes for the builder. */
export const PUT = route(async (req: Request, { params }: Ctx) => {
  const id = (await params).id;
  const b = await body(req, z.object({ profile: z.string().max(200_000).optional(), notes: z.string().max(50_000).optional() }));
  const s = store();
  if (b.notes !== undefined) setBriefNotes(s, id, b.notes);
  if (b.profile !== undefined) saveProfile(s, id, b.profile);
  return ok(getBrief(s, id));
});
