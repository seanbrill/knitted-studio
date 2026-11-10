import { designVersion, getDesignMeta, piecesKey } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * The sheet as the board lays it out: its sections and frames without their code, with how tall
 * each frame was last drawn. ?since=<version>: when the sheet is still at that version, only
 * { same: true }, so a board told something changed somewhere in the studio asks for next to nothing.
 * With &pieces=<key>, its pieces must look as they did too: a pattern on the sheet can change, or
 * go, while the sheet does not.
 */
export const GET = route(async (req: Request, { params }: { params: Promise<{ did: string }> }) => {
  const { did } = await params;
  const q = new URL(req.url).searchParams;
  const since = q.get("since"), pieces = q.get("pieces") ?? "";
  const s = store();
  if (since && Number(since) === designVersion(s, did) && (!pieces || pieces === piecesKey(s, did))) return ok({ same: true });
  return ok(getDesignMeta(s, did));
});
