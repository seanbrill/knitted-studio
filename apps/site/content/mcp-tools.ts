// The tools the MCP server exposes, as a typed list.
//
// The /mcp page and the MCP reference doc are both built from this file, so they
// cannot disagree with each other. The list itself is mcp-tools.json, written from
// the server's own TOOLS by `npm run mcp:tools`; a test fails when it falls behind.

import catalog from "./mcp-tools.json";

export interface McpParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface McpTool {
  name: string;
  summary: string;
  params: McpParam[];
  example?: { call: string; result: string };
}

const EXAMPLES: Record<string, McpTool["example"]> = {
  fill_slots: {
    call: '{ "projectId": "pj_sample", "patternId": "pt_launch_story",\n  "slots": { "headline": "Make it knitted.", "eyebrow": "Big news" } }',
    result: '{\n  "filled": ["headline"],\n  "refused": [\n    { "slot": "eyebrow", "why": "locked by the pattern; unlock it in the studio first" }\n  ]\n}',
  },
};

export const MCP_TOOLS: McpTool[] = catalog.map((t) => ({ ...t, example: EXAMPLES[t.name] }));

export const MCP_CONFIG = `{
  "mcpServers": {
    "knitted": {
      "command": "node",
      "args": ["/path/to/knitted-studio/packages/mcp/src/server.mjs"]
    }
  }
}`;

/** The shape of the command Settings, Model gives you; yours has your own address. */
export const MCP_COMMAND = "claude mcp add --scope user --transport http knitted http://127.0.0.1:PORT/api/mcp/YOUR-KEY";
