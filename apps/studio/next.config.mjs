import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The studio is a server, not a static export: it reads the store and runs
  // the engine. "standalone" traces only what is needed into one folder, which
  // is what the desktop app embeds.
  output: "standalone",
  // Standalone tracing must start at the repo root or workspace packages are
  // silently missing from the output.
  outputFileTracingRoot: join(here, "../.."),
  transpilePackages: ["@knitted/agent", "@knitted/mcp", "@knitted/core", "@knitted/ui", "@knitted/render", "@knitted/engine"],
  devIndicators: false,
  // Settings, About shows the version a release is named for (scripts/release.mjs). A model
  // asks get_studio_info when this build was made, to tell an older copy still running.
  env: { KNITTED_VERSION: version, KNITTED_BUILT_AT: new Date().toISOString() },
  // The engine shells out to ffmpeg and Playwright; neither belongs in a
  // client bundle, and Next will try to trace them without this. PDFium is
  // WebAssembly that loads itself, which a bundler would only get in the way of.
  serverExternalPackages: ["playwright", "sharp", "@hyzyla/pdfium"],
  // Rendered pages are cached in memory, never written beside the server. In the
  // desktop app the server lives inside the signed app, and one written file breaks
  // the signature (macOS then calls the app damaged); it may not be writable at all.
  experimental: { isrFlushToDisk: false },
  // The font routes read files by path, which the tracer cannot see on its own. Playwright
  // is out of its sight too: the engine imports it when it knits (webpackIgnore), and the
  // browser download runs its installer by path (cli.js and the files it starts). Left out,
  // the desktop app can neither knit nor download the browser. Standalone output is every
  // route's files together, so listing them on one route puts them in the whole server.
  // Of playwright itself only the entry files: they hand everything to playwright-core.
  outputFileTracingIncludes: {
    "/api/fonts/[file]": ["../../packages/fonts/files/**"],
    "/api/projects/[id]/fonts.css": ["../../packages/fonts/src/**"],
    "/api/renderer": [
      ...["package.json", "index.js", "index.mjs", "LICENSE", "NOTICE"].map((f) => `../../node_modules/playwright/${f}`),
      "../../node_modules/playwright-core/**",
    ],
    // core reads the wasm by path (pdf.ts), out of the tracer's sight.
    "/api/yarn/[yid]/page": ["../../node_modules/@hyzyla/pdfium/dist/pdfium.wasm"],
  },
};
