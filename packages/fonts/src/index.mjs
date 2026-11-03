// The bundled fonts: curated, open-licensed, and shipped with the app.
//
// Node-only (it knows where the files are). The browser asks the studio's
// /api/fonts routes instead of importing this.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "./manifest.json" with { type: "json" };

export { manifest };
export const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "files");

export const fontPath = (file) => join(fontsDir, file);
export const bundledFont = (family) => manifest.find((f) => f.family === family);

/**
 * @font-face rules for some families. `urlFor(file)` decides where the browser
 * (or the render engine) finds each file, so the editor can use /api/fonts/... and
 * the engine can use file:// without two copies of this logic.
 */
export function fontFaceCss(families, urlFor) {
  return families
    .map((family) => bundledFont(family))
    .filter(Boolean)
    .map((f) => `@font-face{font-family:"${f.family}";src:url("${urlFor(f.file)}") format("woff2");font-weight:${f.weight[0]} ${f.weight[1]};font-style:${f.style};font-display:block}`)
    .join("\n");
}
