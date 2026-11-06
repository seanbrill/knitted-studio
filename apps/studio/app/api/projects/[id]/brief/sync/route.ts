import { z } from "zod";
import { startSync } from "@knitted/agent/profile";
import { body, ok, route, store } from "@/lib/server";
import { modelRun } from "@/lib/chats";

export const dynamic = "force-dynamic";

/**
 * Sync the project with its business's website and build its brief: read the site, read a
 * swatch from it, have the person's model write the profile, and picture every page read
 * for the reference. Each step is asked for, and one that cannot run (no key, no browser)
 * says why while the rest go on. A job: read it at /api/jobs/[jid], stop it with DELETE there.
 */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = (await params).id;
  const b = await body(req, z.object({
    url: z.string().max(2000).optional(), writeUp: z.string().max(200_000).optional(), reference: z.boolean().optional(), mode: z.enum(["merge", "replace"]).optional(),
    profile: z.boolean().optional(), pictures: z.boolean().optional(), swatch: z.boolean().optional(), activateSwatch: z.boolean().optional(),
    devices: z.array(z.enum(["desktop", "mobile"])).min(1).optional(), maxPages: z.number().int().min(1).max(80).optional(),
  }).strict());
  const s = store();
  s.getProject(id);
  const { model, baseUrl } = modelRun(s);
  return ok(startSync(s, { projectId: id, ...b, model, baseUrl }), 202);
});
