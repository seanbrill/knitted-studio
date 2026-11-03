// What a tool needs to run: the store, the engine (loaded when first needed, so
// listing projects does not pull in a renderer), and per-session limits.

import { getStore } from "@knitted/core/node";
import { TOOLS, toolByName } from "./tools.mjs";

let engineMod;
/** The slice of the engine tools use. Loaded lazily and cached. */
export async function loadEngine(store) {
  engineMod ??= await import("@knitted/engine");
  return { ...engineMod, activeVoice: () => engineMod.activeVoice(store) };
}

export async function toolContext({ store = getStore(), limits } = {}) {
  return { store, engine: await loadEngine(store), limits };
}

function missing(schema, args) {
  return (schema.required ?? []).filter((k) => args?.[k] === undefined || args?.[k] === null || args?.[k] === "");
}

/** Run one tool. Throws a plain-language Error for anything the caller got wrong. */
export async function runTool(name, args, ctx) {
  const tool = toolByName[name];
  if (!tool) throw new Error(`There is no tool called "${name}". The tools are: ${TOOLS.map((t) => t.name).join(", ")}.`);
  const gone = missing(tool.inputSchema, args);
  if (gone.length) throw new Error(`${name} needs ${gone.join(", ")}.`);
  return tool.handler(args ?? {}, ctx);
}

export { TOOLS };
