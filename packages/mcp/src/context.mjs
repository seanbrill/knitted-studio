// What a tool needs to run: the store, the engine (loaded when first needed, so
// listing projects does not pull in a renderer), per-session limits, and which model
// is calling, so the studio can say who is at work.

import { agentBegin, agentEnd, agentState, getStore } from "@knitted/core/node";
import { TOOLS, toolByName, READ_ONLY } from "./tools.mjs";
import { describeCall, endOf } from "./activity.mjs";

let engineMod;
/** The slice of the engine tools use. Loaded lazily and cached. */
export async function loadEngine(store) {
  engineMod ??= await import("@knitted/engine");
  return { ...engineMod, activeVoice: () => engineMod.activeVoice(store) };
}

/** @param {{ store?: import("@knitted/core/node").Store, limits?: { maxKnits?: number, knitted?: number }, client?: string }} [o] */
export async function toolContext({ store = getStore(), limits, client } = {}) {
  return { store, engine: await loadEngine(store), limits, client };
}

// What an MCP client calls itself in initialize, as a person would say it.
const KNOWN = { "claude-code": "Claude Code", "claude-ai": "Claude", "claude desktop": "Claude", cursor: "Cursor", "cursor-vscode": "Cursor", vscode: "VS Code", "visual studio code": "VS Code", windsurf: "Windsurf", zed: "Zed" };
/** The name the studio shows for a model, from the clientInfo.name it gave when it connected. */
export function clientLabel(name) {
  const n = String(name ?? "").trim();
  if (!n) return "A model";
  return KNOWN[n.toLowerCase()] ?? n.slice(0, 40);
}

function missing(schema, args) {
  return (schema.required ?? []).filter((k) => args?.[k] === undefined || args?.[k] === null || args?.[k] === "");
}

const PAUSED = "The person paused you in the studio, so nothing can be changed right now. Tell them what you were about to do, and wait until they press Resume. Reading, checking and previewing still work.";

// The studio shows every call while it runs and how it ended (packages/core/src/agent.ts).
// Showing it must never be why a call fails, so a write that cannot be made is let go.
const quietly = (f) => { try { return f(); } catch { return null; } };

/** Run one tool. Throws a plain-language Error for anything the caller got wrong. */
export async function runTool(name, args, ctx) {
  const tool = toolByName[name];
  if (!tool) throw new Error(`There is no tool called "${name}". The tools are: ${TOOLS.map((t) => t.name).join(", ")}.`);
  const gone = missing(tool.inputSchema, args);
  if (gone.length) throw new Error(`${name} needs ${gone.join(", ")}.`);
  args = args ?? {};
  const { store } = ctx;
  const edits = !READ_ONLY.has(name);
  const { summary, where } = quietly(() => describeCall(name, args, store)) ?? { summary: name.replace(/_/g, " "), where: {} };
  const id = quietly(() => agentBegin(store, { client: ctx.client ?? "A model", tool: name, summary, edits, where }));
  // Paused, a model may still look, and may still stop a job it started.
  if (edits && name !== "cancel_job" && quietly(() => agentState(store).paused)) {
    if (id) quietly(() => agentEnd(store, id, { state: "refused", note: "Paused in the studio." }));
    throw new Error(PAUSED);
  }
  try {
    const out = await tool.handler(args, ctx);
    if (id) quietly(() => agentEnd(store, id, endOf(name, args, out, store)));
    return out;
  } catch (e) {
    if (id) quietly(() => agentEnd(store, id, { state: "failed", note: String(e?.message ?? e) }));
    throw e;
  }
}

export { TOOLS };
// A call in words, for a run's steps in the studio: "Filling headline on Story".
export { describeCall };
