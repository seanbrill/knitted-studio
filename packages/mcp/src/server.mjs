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
import { answer } from "./protocol.mjs";

// The same store the studio uses. Nothing here is a model-only path: a model's
// edit and a person's edit are one operation on one document, so each sees the
// other's work. The lock rule is enforced in @knitted/core, not here.
const store = () => getStore();

// A fresh context per call: the store is a process-wide singleton, and limits are per conversation.
const call = async (name, args) => runTool(name, args, await toolContext({ store: store() }));

/** The tools as plain async functions, one per registry entry, so tests and scripts can call them without MCP. */
export const tools = Object.fromEntries(TOOLS.map((t) => [t.name, (args) => call(t.name, args)]));

// ── The MCP wire format over stdio: one JSON-RPC message per line ───────────
//
// The messages themselves are answered in protocol.mjs, which the studio's HTTP
// door uses too.

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
      const reply = await answer(msg, call);
      if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
    }
  });
}
