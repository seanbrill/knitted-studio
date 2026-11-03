import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

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
  // The engine shells out to ffmpeg and Playwright; neither belongs in a
  // client bundle, and Next will try to trace them without this.
  serverExternalPackages: ["playwright", "sharp"],
  // The font routes read files by path, which the tracer cannot see on its own.
  outputFileTracingIncludes: { "/api/fonts/[file]": ["../../packages/fonts/files/**"], "/api/projects/[id]/fonts.css": ["../../packages/fonts/src/**"] },
};
