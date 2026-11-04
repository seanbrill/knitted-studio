import { z } from "zod";
import { matchFonts, proposeFromWebsite } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Returns a PROPOSAL and saves nothing: the person reviews it, then creates the swatch
// (from-site). `matched` says which of its fonts this project can really draw.
export const POST = route(async (req: Request, { params }: Ctx) => {
  const projectId = (await params).id;
  store().getProject(projectId);
  const proposal = await proposeFromWebsite((await body(req, z.object({ url: z.string().max(2000) }))).url);
  return ok({ ...proposal, matched: matchFonts(store(), projectId, proposal.fontRoles).matched });
});
