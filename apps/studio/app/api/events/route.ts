import { agentRev, agentState } from "@knitted/core/node";
import { store } from "@/lib/server";

export const dynamic = "force-dynamic";

// A change stream with no broker. The store bumps a counter inside every write
// transaction, from any process (this server, MCP, the render worker); we poll
// it cheaply and tell the browser "something changed", and the browser refetches
// what it is showing. That is how an open editor sees a model's edit land.
//
// Models have a counter of their own (packages/core/src/agent.ts): what one is doing is
// sent whole, as "agent", so the studio can show it working without asking again.
export function GET(req: Request) {
  const s = store();
  let last = -1, lastAgent = -1;
  let timer: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const tick = () => {
        try {
          const rev = s.rev();
          if (rev !== last) { last = rev; send("changed", { rev }); }
          const a = agentRev(s);
          if (a !== lastAgent) { lastAgent = a; send("agent", agentState(s)); }
        } catch { /* a locked read: try again next tick */ }
      };
      tick();
      timer = setInterval(tick, 400);
      req.signal.addEventListener("abort", () => { clearInterval(timer); try { controller.close(); } catch {} });
    },
    cancel() { clearInterval(timer); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store, no-transform", connection: "keep-alive" } });
}
