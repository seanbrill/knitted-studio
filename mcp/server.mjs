#!/usr/bin/env node
// knitted.studio over MCP, so a model can do what the UI does.
//
// ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
//
// The point of the product is that a person and their model work on the same
// material. If the model can only produce finished files, it is a generator
// with a chat window attached; if it can read Patterns, change Stitches and
// knit, then the Pattern is a shared document and the human can take over at
// any point - which is the actual pitch.
//
// So this server exposes the SAME operations the editor calls, against the
// same store. Nothing here is a model-only path.
//
// ── THE RULE THAT KEEPS IT SAFE ────────────────────────────────────────────
//
// A locked Stitch cannot be changed through this interface. Locked means the
// brand decided it, and "the model may override the brand if it is confident"
// is how brand consistency dies quietly. Unlocking is a human act in the UI.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const ROOT = process.env.KNITTED_HOME ?? join(homedir(), ".knitted-studio");
const PROJECTS = join(ROOT, "projects");

async function loadProject(id) {
  const raw = await readFile(join(PROJECTS, id, "project.json"), "utf8");
  return JSON.parse(raw);
}

async function saveProject(id, data) {
  await mkdir(join(PROJECTS, id), { recursive: true });
  await writeFile(join(PROJECTS, id, "project.json"), JSON.stringify(data, null, 2), "utf8");
}

/** The tools, each a plain async function so they are testable without MCP. */
export const tools = {
  async list_projects() {
    try {
      const dirs = await readdir(PROJECTS, { withFileTypes: true });
      return dirs.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
  },

  async get_pattern({ projectId, patternId }) {
    const p = await loadProject(projectId);
    const pattern = p.patterns?.find((x) => x.id === patternId);
    if (!pattern) throw new Error(`no pattern ${patternId} in ${projectId}`);
    return pattern;
  },

  /**
   * Change the content of named slots.
   *
   * Slots, not stitch ids, because a slot is what a Pattern PROMISES - every
   * launch story has a "headline" - while an id is an implementation detail
   * that changes when somebody rebuilds the layout. A model writing to slots
   * keeps working across a redesign.
   */
  async fill_slots({ projectId, patternId, slots }) {
    const project = await loadProject(projectId);
    const pattern = project.patterns?.find((x) => x.id === patternId);
    if (!pattern) throw new Error(`no pattern ${patternId}`);

    const refused = [];
    const filled = [];
    for (const [slot, content] of Object.entries(slots)) {
      const stitch = pattern.stitches.find((s) => s.slot === slot);
      if (!stitch) {
        refused.push({ slot, why: "no stitch with that slot" });
        continue;
      }
      if (stitch.locked) {
        // Reported, not silently skipped. A model that believes it wrote a
        // headline and did not is worse than one that is told no.
        refused.push({ slot, why: "locked by the pattern; unlock it in the studio first" });
        continue;
      }
      stitch.content = String(content);
      filled.push(slot);
    }
    await saveProject(projectId, project);
    return { filled, refused };
  },

  /**
   * Knit a pattern.
   *
   * Returns the files produced. The heavy work is in engine/knit.mjs and needs
   * Playwright and ffmpeg; this is the thin call so that a model asking for
   * twelve posts gets twelve files rather than twelve descriptions of files.
   */
  async knit_pattern({ projectId, patternId, variants = 1 }) {
    const { knit, materialise } = await import("../engine/knit.mjs");
    let chromium;
    try {
      ({ chromium } = await import("playwright"));
    } catch {
      throw new Error(
        "Knitting needs Playwright. Install it with `npm i playwright && npx playwright install chromium`."
      );
    }
    const pattern = await tools.get_pattern({ projectId, patternId });
    const outDir = join(PROJECTS, projectId, "knits");
    const pageDir = join(PROJECTS, projectId, ".pages");
    const file = await materialise(pattern, pageDir);

    const browser = await chromium.launch();
    try {
      const out = [];
      for (let i = 0; i < variants; i++) {
        const page = await browser.newPage({
          viewport: { width: pattern.size.w, height: pattern.size.h },
          deviceScaleFactor: 1,
        });
        await page.goto(`file://${file}`);
        const r = await knit(page, {
          outDir,
          name: variants > 1 ? `${pattern.id}-${i + 1}` : pattern.id,
          durationMs: pattern.durationMs,
        });
        out.push(...r.files);
        await page.close();
      }
      return { files: out };
    } finally {
      await browser.close();
    }
  },
};

// ── The MCP wire format ─────────────────────────────────────────────────────
//
// Deliberately hand-rolled rather than pulling in an SDK for a first
// iteration: the protocol surface used here is three methods, and a dependency
// that has to be upgraded in lockstep with a host is a poor trade for that.

const SCHEMAS = {
  list_projects: { description: "Every project in this knitted.studio.", inputSchema: { type: "object", properties: {} } },
  get_pattern: {
    description: "Read one pattern, including its stitches and which are locked.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, patternId: { type: "string" } },
      required: ["projectId", "patternId"],
    },
  },
  fill_slots: {
    description:
      "Write content into named slots of a pattern. Locked slots are refused and reported.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        patternId: { type: "string" },
        slots: { type: "object", description: "slot name -> content" },
      },
      required: ["projectId", "patternId", "slots"],
    },
  },
  knit_pattern: {
    description: "Produce output files from a pattern.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        patternId: { type: "string" },
        variants: { type: "number" },
      },
      required: ["projectId", "patternId"],
    },
  },
};

async function handle(msg) {
  if (msg.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "knitted-studio", version: "0.1.0" },
    };
  }
  if (msg.method === "tools/list") {
    return { tools: Object.entries(SCHEMAS).map(([name, s]) => ({ name, ...s })) };
  }
  if (msg.method === "tools/call") {
    const fn = tools[msg.params?.name];
    if (!fn) throw new Error(`no tool ${msg.params?.name}`);
    const result = await fn(msg.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
  throw new Error(`unknown method ${msg.method}`);
}

// Only speak the protocol when actually run as a server, so the tools above
// can be imported by a test without a stdio loop starting.
if (process.argv[1] && process.argv[1].endsWith("server.mjs")) {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      try {
        const result = await handle(msg);
        if (msg.id !== undefined) {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
        }
      } catch (e) {
        if (msg.id !== undefined) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -32000, message: String(e?.message ?? e) },
            }) + "\n"
          );
        }
      }
    }
  });
}
