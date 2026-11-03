// A second process hammering the same database, for the concurrency test.
// usage: node writer.mjs <dbfile> <patternId> <stitchId> <count>
import { openStore } from "../../src/node.ts";
const [file, patternId, stitchId, count] = process.argv.slice(2);
const store = openStore(file);
for (let i = 1; i <= Number(count); i++) {
  store.apply(patternId, { type: "updateStitch", id: stitchId, patch: { x: i / 1000 } }, "model");
}
console.log("done");
