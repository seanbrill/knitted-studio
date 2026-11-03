// Writes apps/site/content/mcp-tools.json from the MCP server's own tool list, so the
// site's /mcp page and MCP reference describe exactly the tools a model gets. The site
// cannot import the tools themselves (they bring the store with them), so it reads this.
// test/mcp.test.mjs fails when the file is out of date: run `npm run mcp:tools`.

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CATALOG = fileURLToPath(new URL("../apps/site/content/mcp-tools.json", import.meta.url));

const typeOf = (v) => (v.type === "array" && v.items?.type ? `${v.items.type}[]` : v.type ?? "any");
const meaning = (v) => [v.description, v.enum && `One of ${v.enum.join(", ")}.`].filter(Boolean).join(". ");

/** What the site shows of each tool: its name, what it does and what it takes. */
export function catalog(tools) {
  return tools.map((t) => ({
    name: t.name,
    summary: t.description,
    params: Object.entries(t.inputSchema?.properties ?? {}).map(([name, v]) => ({
      name, type: typeOf(v), required: (t.inputSchema.required ?? []).includes(name), description: meaning(v),
    })),
  }));
}

export const text = (tools) => JSON.stringify(catalog(tools), null, 2) + "\n";

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { TOOLS } = await import("@knitted/mcp/tools");
  writeFileSync(CATALOG, text(TOOLS));
  console.log(`Wrote ${TOOLS.length} tools to ${CATALOG}`);
}
