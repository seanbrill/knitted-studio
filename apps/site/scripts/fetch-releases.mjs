// Before the site builds: ask FileFreak what has been released and write it to
// content/releases.json, which the Download page reads.
//
// Runs in Node at build time with a read-only key. The finished site is static
// files, so the key is never in anything a visitor can download. Each button points
// at the file's permanent public address.
//
// With no key (a fresh clone, a fork, local development) this does nothing and the
// committed list is used, so the site always builds.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FileFreak } from "@filefreak.io/sdk";
import { buildReleases } from "./releases-lib.mjs";

const target = join(dirname(fileURLToPath(import.meta.url)), "../content/releases.json");
const key = process.env.KNITTED_RELEASE_DOWNLOAD_KEY;
if (!key) {
  console.log("releases: no KNITTED_RELEASE_DOWNLOAD_KEY, keeping the list already in content/releases.json");
  process.exit(0);
}

const ff = new FileFreak({ apiKey: key });
const items = [];
try {
  for await (const item of ff.tree.walk({})) items.push(item);
} catch (e) {
  // A build that silently shipped an empty Download page would be worse than one that stops.
  console.error(`releases: FileFreak refused the listing: ${e.message}`);
  process.exit(1);
}
const { releases, skipped } = buildReleases(items);
if (skipped.length) console.warn(`releases: ${skipped.length} file(s) are not public, so they have no button: ${skipped.join(", ")}.\n          Make the release folder public in FileFreak.`);

const old = JSON.parse(await readFile(target, "utf8"));
await writeFile(target, JSON.stringify({ note: old.note, releases }, null, 2) + "\n");
console.log(`releases: ${releases.length} version(s)${releases[0] ? `, newest ${releases[0].version} with ${releases[0].files.length} file(s)` : ""}`);
