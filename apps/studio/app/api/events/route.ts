import { store } from "@/lib/server";

export const dynamic = "force-dynamic";

// A change stream with no broker. The store bumps a counter inside every write
// transaction, from any process (this server, MCP, the render worker); we poll
// it cheaply and tell the browser "something changed", and the browser refetches
// what it is showing. That is how an open editor sees a model's edit land.
export function GET(req: Request) {
  const s = store();
  let last = -1;
  let timer: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const tick = () => {
        try {
          const rev = s.rev();
          if (rev !== last) { last = rev; send("changed", { rev }); }
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
