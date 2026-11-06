"use client";

// Markdown, read into React elements: a model's answer, a profile of a business. Never HTML:
// whatever is written is shown as the words it is, and React escapes every one, so a reply
// cannot run a script or load a picture from somewhere. Links go only to the web or to an
// email address, and open outside the studio.
//
// The common part of CommonMark and GitHub's: headings, paragraphs, emphasis, code, lists
// in lists, quotes, rules and tables. A line break inside a paragraph is kept, as a chat
// reply means it.

import * as React from "react";
import { cx } from "./cx.ts";

type Inline = React.ReactNode;
type Block =
  | { t: "p"; text: string }
  | { t: "h"; level: number; text: string }
  | { t: "code"; text: string; lang: string }
  | { t: "quote"; blocks: Block[] }
  | { t: "list"; ordered: boolean; start: number; tight: boolean; items: Block[][] }
  | { t: "table"; align: ("left" | "center" | "right" | null)[]; head: string[]; rows: string[][] }
  | { t: "hr" };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const DELIM_ROW = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;

const indentOf = (line: string) => line.length - line.trimStart().length;
const blank = (line: string) => !line.trim();

function cells(row: string): string[] {
  const s = row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  const out: string[] = [];
  let cur = "", code = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (c === "`") code = !code;
    if (c === "|" && !code) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Whether a line begins a block of its own, and so ends the paragraph before it. */
function starts(line: string, next?: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line) || (line.includes("|") && !!next && DELIM_ROW.test(next) && next.includes("-"));
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }
    const fence = line.match(FENCE);
    if (fence) {
      const mark = fence[1], body: string[] = [];
      const pad = indentOf(line);
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(mark[0].repeat(mark.length)) && lines[i].trim().replace(new RegExp(`^\\${mark[0]}+`), "").trim() === "")) {
        body.push(lines[i].slice(Math.min(pad, indentOf(lines[i]))));
        i++;
      }
      i++;
      out.push({ t: "code", text: body.join("\n"), lang: fence[2] ?? "" });
      continue;
    }
    const h = line.match(HEADING);
    if (h) { out.push({ t: "h", level: h[1].length, text: h[2] ?? "" }); i++; continue; }
    if (RULE.test(line)) { out.push({ t: "hr" }); i++; continue; }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && !blank(lines[i]) && (QUOTE.test(lines[i]) || !starts(lines[i]))) { inner.push(lines[i].match(QUOTE)?.[1] ?? lines[i]); i++; }
      out.push({ t: "quote", blocks: blocks(inner) });
      continue;
    }
    if (ITEM.test(line)) { const [list, at] = listAt(lines, i); out.push(list); i = at; continue; }
    if (line.includes("|") && i + 1 < lines.length && DELIM_ROW.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && !blank(lines[i]) && lines[i].includes("|")) { const r = cells(lines[i]); rows.push(head.map((_, k) => r[k] ?? "")); i++; }
      out.push({ t: "table", align: head.map((_, k) => align[k] ?? null), head, rows });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !blank(lines[i]) && (para.length === 0 || !starts(lines[i], lines[i + 1]))) { para.push(lines[i].trim()); i++; }
    out.push({ t: "p", text: para.join("\n") });
  }
  return out;
}

/** A list from line `i`: its items, each the blocks indented under it, lists in lists among them. */
function listAt(lines: string[], i: number): [Block, number] {
  const first = lines[i].match(ITEM)!;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: Block[][] = [];
  let tight = true;
  while (i < lines.length) {
    const m = lines[i].match(ITEM);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    const inside = indent + m[2].length + 1;
    const body = [m[3] ?? ""];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (blank(l)) {
        let k = i + 1;
        while (k < lines.length && blank(lines[k])) k++;
        if (k < lines.length && indentOf(lines[k]) >= inside) { body.push(""); tight = false; i++; continue; }
        // A blank line between two items of this list loosens it; anything else ends it.
        const n = k < lines.length ? lines[k].match(ITEM) : null;
        if (n && n[1].length === indent && /\d/.test(n[2]) === ordered) { tight = false; i = k; }
        break;
      }
      if (indentOf(l) > indent) { body.push(l.slice(Math.min(indentOf(l), inside))); i++; continue; }
      if (!starts(l, lines[i + 1])) { body.push(l.trim()); i++; continue; }
      break;
    }
    items.push(blocks(body));
  }
  return [{ t: "list", ordered, start: ordered ? Number.parseInt(first[2], 10) : 1, tight, items }, i];
}

// ── inline ───────────────────────────────────────────────────────────────────
const SAFE = /^(https?:\/\/|mailto:)/i;
// An address written out, as GitHub links one: brackets in it when they pair, and not the full stop after it.
const BARE = /^((?:https?:\/\/|www\.)(?:[^\s<>()]|\([^\s<>()]*\))*(?:[^\s<>().,;:!?'"*_~]|\([^\s<>()]*\)))/i;
// [words](address "title"), the address with one level of brackets in it, as Wikipedia's have.
const LINK = /^\[((?:\\.|[^\]\\])*)\]\(\s*<?((?:[^\s()<>]|\([^\s()<>]*\))+)>?(?:\s+"([^"]*)")?\s*\)/;
const PUNCT = /[\\`*_{}[\]()#+\-.!|~<>"'$%&,/:;=?@^]/;

function link(href: string, children: React.ReactNode, key: number, title?: string) {
  const to = href.trim();
  if (!SAFE.test(to)) return <React.Fragment key={key}>{children}</React.Fragment>;
  return <a key={key} href={to} title={title} target="_blank" rel="noreferrer">{children}</a>;
}

/** Where a run of `mark` closes in `s`, from `from`: a closer with something before it, not a space. */
function closer(s: string, mark: string, from: number): number {
  for (let k = s.indexOf(mark, from); k >= 0; k = s.indexOf(mark, k + 1)) {
    if (k > from && !/\s/.test(s[k - 1]) && s[k - 1] !== "\\") {
      if (mark[0] === "_" && /\w/.test(s[k + mark.length] ?? "")) continue;
      if (mark.length === 1 && s[k + 1] === mark && s[k - 1] !== mark) { k++; continue; }
      return k;
    }
  }
  return -1;
}

function inline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => { if (text) { out.push(text); text = ""; } };
  const push = (n: Inline) => { flush(); out.push(n); };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && PUNCT.test(s[i + 1] ?? "")) { text += s[i + 1]; i += 2; continue; }
    if (c === "\n") { push(<br key={out.length} />); i++; continue; }
    if (c === "`") {
      const run = s.slice(i).match(/^`+/)![0];
      const end = s.indexOf(run, i + run.length);
      if (end > 0) { const code = s.slice(i + run.length, end); push(<code key={out.length}>{code.length > 2 && code.startsWith(" ") && code.endsWith(" ") ? code.slice(1, -1) : code}</code>); i = end + run.length; continue; }
      text += run; i += run.length; continue;
    }
    if (c === "!" && s[i + 1] === "[") {
      // A picture is not fetched from anywhere: its words, and a link to it.
      const m = s.slice(i + 1).match(LINK);
      if (m) { push(link(m[2], m[1] || m[2], out.length, m[3])); i += 1 + m[0].length; continue; }
    }
    if (c === "[") {
      const m = s.slice(i).match(LINK);
      if (m) { push(link(m[2], inline(m[1]), out.length, m[3])); i += m[0].length; continue; }
    }
    if (c === "<") {
      const m = s.slice(i).match(/^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i);
      if (m) { push(link(m[1], m[1].replace(/^mailto:/i, ""), out.length)); i += m[0].length; continue; }
    }
    if ((c === "h" || c === "w" || c === "H" || c === "W") && !/\w/.test(s[i - 1] ?? "")) {
      const m = s.slice(i).match(BARE);
      if (m) { push(link(/^www\./i.test(m[1]) ? `https://${m[1]}` : m[1], m[1], out.length)); i += m[1].length; continue; }
    }
    if (c === "*" || c === "_" || c === "~") {
      const run = s.slice(i).match(c === "~" ? /^~~/ : c === "*" ? /^\*{1,3}/ : /^_{1,3}/)?.[0];
      const opens = !!run && !/\s/.test(s[i + run.length] ?? " ") && !(c === "_" && /\w/.test(s[i - 1] ?? ""));
      if (run && opens) {
        const mark = run.length === 3 ? c.repeat(3) : run;
        const end = closer(s, mark, i + mark.length);
        if (end > 0) {
          const inner = inline(s.slice(i + mark.length, end));
          const k = out.length;
          push(mark === "~~" ? <del key={k}>{inner}</del>
            : mark.length === 3 ? <strong key={k}><em>{inner}</em></strong>
            : mark.length === 2 ? <strong key={k}>{inner}</strong>
            : <em key={k}>{inner}</em>);
          i = end + mark.length;
          continue;
        }
      }
      text += run ?? c; i += (run ?? c).length; continue;
    }
    text += c; i++;
  }
  flush();
  return out;
}

function render(b: Block, key: number, top: number): React.ReactNode {
  switch (b.t) {
    case "p": return <p key={key}>{inline(b.text)}</p>;
    case "h": { const H = `h${Math.min(6, top + b.level - 1)}` as "h3"; return <H key={key}>{inline(b.text)}</H>; }
    case "code": return <pre key={key} data-lang={b.lang || undefined}><code>{b.text}</code></pre>;
    case "quote": return <blockquote key={key}>{b.blocks.map((x, k) => render(x, k, top))}</blockquote>;
    case "hr": return <hr key={key} />;
    case "list": {
      const items = b.items.map((item, k) => (
        <li key={k}>{item.map((x, n) => (b.tight && x.t === "p" ? <React.Fragment key={n}>{n > 0 && <br />}{inline(x.text)}</React.Fragment> : render(x, n, top)))}</li>
      ));
      return b.ordered ? <ol key={key} start={b.start !== 1 ? b.start : undefined}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    case "table": return (
      <table key={key}>
        <thead><tr>{b.head.map((h, k) => <th key={k} style={b.align[k] ? { textAlign: b.align[k]! } : undefined}>{inline(h)}</th>)}</tr></thead>
        <tbody>{b.rows.map((r, n) => <tr key={n}>{r.map((c, k) => <td key={k} style={b.align[k] ? { textAlign: b.align[k]! } : undefined}>{inline(c)}</td>)}</tr>)}</tbody>
      </table>
    );
  }
}

/**
 * Markdown as plain, safe React. `topLevel` is the heading a "#" becomes, so a reply's
 * headings sit under the page's own: 3 by default, "#" an h3 and "######" an h6 at most.
 */
export const Markdown = React.memo(function Markdown({ text, className, topLevel = 3 }: { text: string; className?: string; topLevel?: number }) {
  const tree = React.useMemo(() => blocks(String(text ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n")), [text]);
  return <div className={cx("md", className)}>{tree.map((b, k) => render(b, k, Math.max(1, Math.min(6, topLevel))))}</div>;
});
