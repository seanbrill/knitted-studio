import { z } from "zod";
import { setSpendLimits, usageSummary } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** What the person's key has spent, this month and by day, and the limits. */
export const GET = route(async () => ok(usageSummary(store())));

const Dollars = z.number().min(0).max(100_000).nullable();
const Put = z.object({ monthly: Dollars.optional(), perRun: Dollars.optional(), warnAt: z.number().min(0.1).max(1).optional() }).strict();
export const PUT = route(async (req: Request) => {
  setSpendLimits(store(), await body(req, Put));
  return ok(usageSummary(store()));
});
