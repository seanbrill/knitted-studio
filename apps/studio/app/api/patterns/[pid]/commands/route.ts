import { z } from "zod";
import { CommandSchema } from "@knitted/core";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

// The browser may act as a person in Pattern mode or in Fill mode, and nothing
// else. It cannot claim to be a model: a model's edits arrive through MCP or the
// in-app loop on the server, where the actor is set by the code, not the caller.
const Body = z.object({
  command: CommandSchema,
  actor: z.enum(["human", "fill"]).default("human"),
  expectVersion: z.number().int().optional(),
  label: z.string().max(60).optional(),
  coalesce: z.boolean().optional(),
});

export const POST = route(async (req: Request, { params }: { params: Promise<{ pid: string }> }) => {
  const b = await body(req, Body);
  const r = store().apply((await params).pid, b.command as never, b.actor, { expectVersion: b.expectVersion, label: b.label, coalesce: b.coalesce });
  return ok(r);
});
