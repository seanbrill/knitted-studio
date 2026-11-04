import { z } from "zod";
import { COLOR_ROLES, type ColorRole } from "@knitted/core";
import { createSwatchFromProposal } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const Family = z.string().max(80).optional();
const Proposal = z.object({
  name: z.string().max(120),
  colors: z.array(z.object({ role: z.enum(COLOR_ROLES as [ColorRole, ...ColorRole[]]), name: z.string().max(60), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).min(3).max(8),
  fonts: z.object({ display: Family, body: Family, mono: Family }).optional(),
  logo: z.object({ url: z.string().max(2000), use: z.enum(["full", "mark"]) }).optional(),
  folder: z.string().max(400).optional(),
}).strict();

// Saves what the person looked over in the "Start from a website" dialog as a new
// swatch. It is not made the project's swatch: they do that in the editor.
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { folder, ...proposal } = await body(req, Proposal);
  const r = await createSwatchFromProposal(store(), (await params).id, proposal, { actor: "human", activate: false, folder });
  return ok(r, 201);
});
