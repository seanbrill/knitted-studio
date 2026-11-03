import { MCP_TOOLS } from "../../content/mcp-tools";
import { FEATURES } from "../../lib/features";
import { GITHUB, SITE_URL, TAGLINE } from "../../lib/site";
import { allDocs } from "../../lib/docs";

export const dynamic = "force-static";

export function GET() {
  const shipped = FEATURES.filter((f) => f.status === "shipped").map((f) => `- ${f.name}: ${f.summary}`);
  const soon = FEATURES.filter((f) => f.status === "soon").map((f) => `- ${f.name}`);
  const body = `# knitted.studio

> ${TAGLINE}

knitted.studio is an open-source (MIT) studio for making social posts, ads and web graphics from reusable brand Patterns. Locked stitches hold the brand; free stitches are for you and your model. It runs on your own computer.

Vocabulary: Pattern (reusable layout with locked brand slots), Swatch (brand kit), Yarn (raw assets), Stitch (one element), Knit (produce output), Part (reusable fragment smaller than a Pattern).

## Status
This is an early project. Available now:
${shipped.join("\n")}

Not built yet:
${soon.join("\n")}

## Use it from a model (MCP)
The MCP server runs over stdio: node packages/mcp/src/server.mjs. Tools: ${MCP_TOOLS.map((t) => t.name).join(", ")}.
A locked slot cannot be changed through MCP: fill_slots refuses it and reports the refusal.

## Pages
- ${SITE_URL}/features/
- ${SITE_URL}/how-it-works/
- ${SITE_URL}/mcp/
- ${SITE_URL}/download/
${allDocs().map((d) => `- ${SITE_URL}/docs/${d.slug}/ : ${d.title}`).join("\n")}

## Source
${GITHUB}
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
