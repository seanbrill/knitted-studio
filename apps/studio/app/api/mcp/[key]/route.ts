// knitted over MCP's HTTP transport, for Claude Code and other MCP clients on this
// computer: the tools the studio's own model and the stdio server have, run against
// the store this window shows, so their edits appear in it as they are made.
//
// The address holds its own key (Settings, Model, lib/mcp-key.ts), because an MCP
// client cannot have the window's launch token. A wrong key gets a 404, as if nothing
// were here. Each POST carries one JSON-RPC message (or a batch) and gets JSON back:
// no sessions and no stream from the server, which the transport allows.

import { answer } from "@knitted/mcp/protocol";
import { runTool, toolContext } from "@knitted/mcp/context";
import { isMcpKey } from "@/lib/mcp-key";
import { fail, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ key: string }> };

const rpcError = (code: number, message: string, status: number) => Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status });

export async function POST(req: Request, { params }: Ctx) {
  if (!isMcpKey((await params).key)) return fail(404, "not_found", "There is nothing at this address. Copy the current one from Settings, Model.");
  // A web page can send a request here but must not act through it: browsers say where
  // a request comes from, and only the studio's own pages may come from anywhere.
  const origin = req.headers.get("origin");
  if (origin && origin !== `http://${req.headers.get("host")}`) return fail(403, "forbidden", "Web pages cannot use this address.");
  let msg: unknown;
  try { msg = await req.json(); } catch { return rpcError(-32700, "That was not JSON.", 400); }
  const s = store();
  const call = async (name: string, args: Record<string, unknown>) => runTool(name, args, await toolContext({ store: s }));
  const messages: unknown[] = Array.isArray(msg) ? msg : [msg];
  const replies: unknown[] = [];
  for (const m of messages) { const r = await answer(m, call); if (r) replies.push(r); }
  // Only notifications, which get no reply.
  if (!replies.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(msg) ? replies : replies[0]);
}

/** No stream of messages from the server, and no session to end. */
const notHere = () => new Response(null, { status: 405, headers: { allow: "POST" } });
export const GET = notHere;
export const DELETE = notHere;
