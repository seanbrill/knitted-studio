#!/usr/bin/env node
// knitted.studio over MCP, so a model can do what the UI does.
//
// ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
//
// The point of the product is that a person and their model work on the same
// material. If the model can only produce finished files, it is a generator
// with a chat window attached; if it can read Patterns, change Stitches and
// knit, then the Pattern is a shared document and the human can take over at
// any point - which is the actual pitch.
//
// So this server exposes the SAME operations the editor calls, against the
// same store. Nothing here is a model-only path.
//
// ── THE RULE THAT KEEPS IT SAFE ────────────────────────────────────────────
//
// A locked Stitch cannot be changed through this interface. Locked means the
// brand decided it, and "the model may override the brand if it is confident"
// is how brand consistency dies quietly. Unlocking is a human act in the UI.

import { getStore } from "@knitted/core/node";
import { runTool, toolContext, TOOLS } from "./context.mjs";

// The same store the studio uses. Nothing here is a model-only path: a model's
// edit and a person's edit are one operation on one document, so each sees the
// other's work. The lock rule is enforced in @knitted/core, not here.
const store = () => getStore();

// A fresh context per call: the store is a process-wide singleton, and limits are per conversation.
const call = async (name, args) => runTool(name, args, await toolContext({ store: store() }));

/** The tools as plain async functions, one per registry entry, so tests and scripts can call them without MCP. */
export const tools = Object.fromEntries(TOOLS.map((t) => [t.name, (args) => call(t.name, args)]));

// ── The MCP wire format ─────────────────────────────────────────────────────
//
// Deliberately hand-rolled rather than pulling in an SDK: the protocol surface used
// here is three methods (initialize, tools/list, tools/call), and a dependency that
// must be upgraded in lockstep with a host is a poor trade for that.

async function handle(msg) {
  if (msg.method === "initialize") {
    return { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "knitted-studio", version: "0.2.0" } };
  }
  if (msg.method === "tools/list") {
    return { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
  }
  if (msg.method === "tools/call") {
    // A tool that fails is a RESULT with isError set, not a protocol error: that is
    // how the model learns what went wrong and tries again.
    try {
      const result = await call(msg.params?.name, msg.params?.arguments ?? {});
      if (result && result.__image) {
        return { content: [{ type: "image", data: result.__image, mimeType: result.mime }, { type: "text", text: result.caption ?? "" }] };
      }
      return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] };
    }
  }
  throw new Error(`unknown method ${msg.method}`);
}

// Only speak the protocol when actually run as a server, so the tools above
// can be imported by a test without a stdio loop starting.
if (process.argv[1] && process.argv[1].endsWith("server.mjs")) {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      try {
        const result = await handle(msg);
        if (msg.id !== undefined) {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
        }
      } catch (e) {
        if (msg.id !== undefined) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -32000, message: String(e?.message ?? e) },
            }) + "\n"
          );
        }
      }
    }
  });
}
