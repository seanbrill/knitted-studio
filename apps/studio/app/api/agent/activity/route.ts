import { z } from "zod";
import { agentState, setAgentPaused } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

// What models have been doing lately, and the person's hand on them: while paused, a
// model's edits are refused and it is told to wait (packages/mcp/src/context.mjs). The
// studio keeps up with it through the change stream (api/events, "agent").
export const GET = route(async () => ok(agentState(store())));

export const POST = route(async (req: Request) => {
  const { paused } = await body(req, z.object({ paused: z.boolean() }));
  return ok(setAgentPaused(store(), paused));
});
