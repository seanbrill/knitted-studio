// The four tools the MCP server exposes today, as a typed list.
//
// The /mcp page and the MCP reference doc are both built from this file, so
// they cannot disagree with each other. It mirrors the SCHEMAS table in
// packages/mcp/src/server.mjs; if a tool is added there, add it here.

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
  returns: string;
  example?: { call: string; result: string };
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "list_projects",
    summary: "Every project in this knitted.studio.",
    params: [],
    returns: "A list of project ids.",
  },
  {
    name: "get_pattern",
    summary: "Read one Pattern, including its stitches and which are locked.",
    params: [
      { name: "projectId", type: "string", required: true, description: "The project that holds the Pattern." },
      { name: "patternId", type: "string", required: true, description: "The Pattern to read." },
    ],
    returns: "The Pattern, with every stitch, its slot name and its locked flag.",
  },
  {
    name: "fill_slots",
    summary: "Write content into named slots of a Pattern. Locked slots are refused and reported.",
    params: [
      { name: "projectId", type: "string", required: true, description: "The project that holds the Pattern." },
      { name: "patternId", type: "string", required: true, description: "The Pattern to fill." },
      { name: "slots", type: "object", required: true, description: "Slot name to content, for example { \"headline\": \"Make it knitted.\" }." },
    ],
    returns: "Two lists: filled (slots that were written) and refused (slots that were not, each with the reason).",
    example: {
      call: '{ "projectId": "pj_sample", "patternId": "pt_launch_story",\n  "slots": { "headline": "Make it knitted.", "eyebrow": "Big news" } }',
      result: '{\n  "filled": ["headline"],\n  "refused": [\n    { "slot": "eyebrow", "why": "locked by the pattern; unlock it in the studio first" }\n  ]\n}',
    },
  },
  {
    name: "knit_pattern",
    summary: "Produce output files from a Pattern.",
    params: [
      { name: "projectId", type: "string", required: true, description: "The project that holds the Pattern." },
      { name: "patternId", type: "string", required: true, description: "The Pattern to knit." },
      { name: "variants", type: "number", required: false, description: "How many to knit. Defaults to 1." },
    ],
    returns: "The list of files produced. Needs Playwright and ffmpeg installed on the machine.",
  },
];

export const MCP_CONFIG = `{
  "mcpServers": {
    "knitted": {
      "command": "node",
      "args": ["/path/to/knitted-studio/packages/mcp/src/server.mjs"]
    }
  }
}`;
