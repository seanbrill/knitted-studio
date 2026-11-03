// Docs are plain markdown in docs/user/*.md with frontmatter (title, order,
// summary, status). They are read and rendered at build time, so the output is
// static HTML and the search index is a JSON file built from the same source.

import fs from "node:fs";
import path from "node:path";
import { Marked } from "marked";
import { MCP_TOOLS, MCP_CONFIG } from "../content/mcp-tools";

export type DocStatus = "shipped" | "partial" | "soon";
export interface Doc {
  slug: string;
  title: string;
  order: number;
  summary: string;
  status: DocStatus;
  /** What exists today, shown in the callout for partial and soon pages. */
  note: string;
  file: string;
  body: string;
}

function docsDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const p = path.join(dir, "docs", "user");
    if (fs.existsSync(p)) return p;
    dir = path.dirname(dir);
  }
  throw new Error("docs/user not found");
}

function parse(file: string, raw: string): Doc {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  const slug = file.replace(/\.md$/, "");
  return {
    slug,
    title: meta.title ?? slug,
    order: Number(meta.order ?? 99),
    summary: meta.summary ?? "",
    status: (meta.status as DocStatus) ?? "shipped",
    note: meta.note ?? "",
    file,
    body: m?.[2] ?? raw,
  };
}

export function allDocs(): Doc[] {
  const dir = docsDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parse(f, fs.readFileSync(path.join(dir, f), "utf8")))
    .sort((a, b) => a.order - b.order);
}

/** The MCP reference is built from the typed tool list, so it cannot go stale. */
function mcpMarkdown(): string {
  const out: string[] = [];
  for (const t of MCP_TOOLS) {
    out.push(`## ${t.name}\n\n${t.summary}\n`);
    if (t.params.length) {
      out.push("| Parameter | Type | Required | Meaning |\n|---|---|---|---|");
      for (const p of t.params) out.push(`| \`${p.name}\` | ${p.type} | ${p.required ? "yes" : "no"} | ${p.description} |`);
      out.push("");
    } else out.push("Takes no parameters.\n");
    if (t.example) out.push(`Example call:\n\n\`\`\`json\n${t.example.call}\n\`\`\`\n\nExample result:\n\n\`\`\`json\n${t.example.result}\n\`\`\`\n`);
  }
  return out.join("\n");
}

function expand(body: string): string {
  return body.replace("{{mcp-tools}}", mcpMarkdown()).replace("{{mcp-config}}", "```json\n" + MCP_CONFIG + "\n```");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const marked = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      return `<h${depth} id="${slugify(text)}">${text}</h${depth}>\n`;
    },
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      return `<a class="link" href="${href}">${text}</a>`;
    },
  },
});

export function renderDoc(doc: Doc): string {
  // The page hero already carries the title as the one h1.
  return marked.parse(expand(doc.body).replace(/^\s*# .*\n/, ""), { async: false }) as string;
}

export interface SearchEntry { slug: string; title: string; summary: string; text: string }

export function searchIndex(): SearchEntry[] {
  return allDocs().map((d) => ({
    slug: d.slug,
    title: d.title,
    summary: d.summary,
    text: expand(d.body).replace(/```[\s\S]*?```/g, " ").replace(/[#*`|>_\[\]()-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000),
  }));
}
