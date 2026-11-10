// knitted over MCP's HTTP transport, for Claude Code and other MCP clients on this
// computer: the tools the studio's own model and the stdio server have, run against
// the store this window shows, so their edits appear in it as they are made.
//
// The address holds its own key (Settings, Model, lib/mcp-key.ts), because an MCP
// client cannot have the window's launch token. A wrong key gets a 404, as if nothing
// were here. Each POST carries one JSON-RPC message (or a batch) and gets JSON back: no
// stream from the server, which the transport allows.
//
// A session is only a name for the tools a client was given. initialize answers with an
// Mcp-Session-Id that names this knitted's version and its tool list, and the client sends it
// back with each request. When knitted is updated while a client stays connected, the client
// still has the old tools and instructions (it reads them only when it connects), so a result
// it gets then says so and asks for a reconnect. Nothing is refused: a client that never sends
// the id, or sends an old one, is answered as before.

import { createHash, randomBytes } from "node:crypto";
import { answer } from "@knitted/mcp/protocol";
import { clientLabel, runTool, toolContext, TOOLS } from "@knitted/mcp/context";
import { isMcpKey } from "@/lib/mcp-key";
import { fail, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ key: string }> };

// Who connected last, from initialize's clientInfo, so the studio can say "Claude Code is
// filling headline". With no sessions there is no telling two clients apart; the last to
// connect names the calls, and a client that never said gets "A model".
const g = globalThis as unknown as { __knittedMcpClient?: string };

/** What names the tools a client is given: their names, descriptions and inputs. */
const toolsKey = createHash("sha1").update(JSON.stringify(TOOLS.map((t: { name: string; description: string; inputSchema: unknown }) => [t.name, t.description, t.inputSchema]))).digest("hex").slice(0, 12);
const version = () => process.env.KNITTED_VERSION || "unknown";
/** A session id: the version and the tools it was given, then its own. Visible ASCII, as the transport asks. */
const newSession = () => `${version().replace(/[^\x21-\x7e]/g, "")}.${toolsKey}.${randomBytes(6).toString("hex")}`;
/** The version a session was given its tools by, when they are not this knitted's; null when they are, or it is not one of ours. */
function staleSince(id: string | null): string | null {
  const m = /^(.+)\.([0-9a-f]{12})\.[0-9a-f]{12}$/.exec(id ?? "");
  return m && m[2] !== toolsKey ? m[1] : null;
}
/** Said after a result to a client whose tools are an older knitted's. */
const reconnect = (was: string) => `knitted was updated since you connected: it is ${version()} now, but your tools and instructions are those of ${was}, so some tools or options may be missing or changed. Ask the person to reconnect knitted (in Claude Code, /mcp, then Reconnect), then go on.`;

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
  const call = async (name: string, args: Record<string, unknown>) => runTool(name, args, await toolContext({ store: s, client: clientLabel(g.__knittedMcpClient) }));
  const messages: unknown[] = Array.isArray(msg) ? msg : [msg];
  const replies: unknown[] = [];
  const was = staleSince(req.headers.get("mcp-session-id"));
  let started = false;
  for (const m of messages) {
    const init = m as { method?: string; params?: { clientInfo?: { name?: unknown } } };
    if (init?.method === "initialize") started = true;
    if (init?.method === "initialize" && typeof init.params?.clientInfo?.name === "string") g.__knittedMcpClient = init.params.clientInfo.name;
    const r = (await answer(m, call)) as { result?: { content?: { type: string; text: string }[] } } | null;
    if (was && init?.method === "tools/call" && Array.isArray(r?.result?.content)) r.result.content.push({ type: "text", text: reconnect(was) });
    if (r) replies.push(r);
  }
  // A new session is named for the tools it is given now; an old one keeps its name, so it is told until it reconnects.
  const headers = started ? { "mcp-session-id": newSession() } : undefined;
  // Only notifications, which get no reply.
  if (!replies.length) return new Response(null, { status: 202, headers });
  return Response.json(Array.isArray(msg) ? replies : replies[0], { headers });
}

/** No stream of messages from the server, and no session to end. */
const notHere = () => new Response(null, { status: 405, headers: { allow: "POST" } });
export const GET = notHere;
export const DELETE = notHere;
