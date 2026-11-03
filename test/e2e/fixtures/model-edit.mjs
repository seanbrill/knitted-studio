// Plays the part of a model on the OTHER side of the library: a separate
// process, the same database, exactly what MCP does.
// usage: node model-edit.mjs <patternId> <slot> <content>
import { getStore } from "@knitted/core/node";
const [patternId, slot, content] = process.argv.slice(2);
const r = getStore().apply(patternId, { type: "fillSlot", slot, content }, "model");
console.log(JSON.stringify({ changed: r.changed, refusals: r.refusals }));
