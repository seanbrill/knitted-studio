import { z } from "zod";
import { setFrameHeights } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

const Sizes = z.object({ sizes: z.record(z.string().max(40), z.object({ rev: z.string().max(64), height: z.number() })) });

/** How tall the board drew frames: kept, so the sheet is laid out right the next time it opens. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ did: string }> }) => {
  const { sizes } = await body(req, Sizes);
  return ok({ kept: setFrameHeights(store(), (await params).did, sizes) });
});
