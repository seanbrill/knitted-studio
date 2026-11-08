import { z } from "zod";
import { changeDesign, deleteDesign, getDesign, restoreDesign, undoDesign } from "@knitted/core/node";
import type { DesignOp } from "@knitted/core";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ did: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(getDesign(store(), (await params).did)));

// Each change is checked again in core (applyDesignOps); this keeps out what is not a change at all.
const Op = z.object({ op: z.enum(["rename", "addSection", "updateSection", "moveSection", "removeSection", "setFrame", "moveFrame", "duplicateFrame", "removeFrame"]) }).passthrough();
const Change = z.union([
  z.object({ ops: z.array(Op).min(1).max(100) }),
  z.object({ undo: z.literal(true) }),
  z.object({ restore: z.literal(true) }),
]);
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { did } = await params;
  const b = await body(req, Change);
  if ("undo" in b) return ok(undoDesign(store(), did));
  if ("restore" in b) return ok(restoreDesign(store(), did));
  return ok(changeDesign(store(), did, b.ops as unknown as DesignOp[]));
});

export const DELETE = route(async (_: Request, { params }: Ctx) => { deleteDesign(store(), (await params).did); return ok({ ok: true }); });
