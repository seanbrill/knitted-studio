import { z } from "zod";
import { changeDesign, deleteDesign, getDesign, getDesignMeta, restoreDesign, undoDesign } from "@knitted/core/node";
import type { DesignOp } from "@knitted/core";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ did: string }> };

export const GET = route(async (_: Request, { params }: Ctx) => ok(getDesign(store(), (await params).did)));

// Each change is checked again in core (applyDesignOps); this keeps out what is not a change at all.
const Op = z.object({ op: z.enum(["rename", "addSection", "updateSection", "moveSection", "removeSection", "placeSection", "setFrame", "addPiece", "moveFrame", "duplicateFrame", "removeFrame"]) }).passthrough();
const Change = z.union([
  z.object({ ops: z.array(Op).min(1).max(100) }),
  z.object({ undo: z.literal(true) }),
  z.object({ restore: z.literal(true) }),
]);
// Answered with the sheet as the board lays it out, without its code: a big sheet's code is megabytes.
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { did } = await params;
  const b = await body(req, Change);
  const s = store();
  if ("undo" in b) { undoDesign(s, did); return ok(getDesignMeta(s, did)); }
  if ("restore" in b) { restoreDesign(s, did); return ok(getDesignMeta(s, did)); }
  const r = changeDesign(s, did, b.ops as unknown as DesignOp[]);
  return ok({ ...getDesignMeta(s, did), made: r.made, lint: r.lint });
});

export const DELETE = route(async (_: Request, { params }: Ctx) => { deleteDesign(store(), (await params).did); return ok({ ok: true }); });
