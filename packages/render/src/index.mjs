// A Pattern as a page.
//
// The one place a Pattern becomes HTML. The editor canvas (an iframe) and the
// engine's screenshots both load this output, which is decision D8: re-render
// the design, never re-implement it. Split out of the engine unchanged so the
// editor can import it without pulling in ffmpeg or a browser.
//
// The `window.__stage` contract is documented in the engine; this file is what
// satisfies it.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pageFor } from "./pure.mjs";

/** Write a Pattern's html/css to a file the browser can open. */
export async function materialise(pattern, dir, ctx) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${pattern.id}.html`);
  await writeFile(file, pageFor(pattern, ctx), "utf8");
  return file;
}

export * from "./pure.mjs";
