// Shared by the guard-rail tests: which files count, and the detectors.
//
// Detectors are pure functions of text so a test can hand them a known-bad
// fixture and require a hit. A guard that has only ever seen clean input has
// not been shown to work.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|icns|woff2?|ttf|otf|mp4|mov|webm|mp3|wav|zip|pdf)$/i;
const SKIP = /(^|\/)package-lock\.json$/;

/** Tracked plus untracked-but-not-ignored text files: what a commit would contain. */
export function projectFiles() {
  const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" });
  // A file deleted from disk can still be in the index until it is committed; skip it.
  return out.split("\0").filter((f) => f && !BINARY.test(f) && !SKIP.test(f) && existsSync(join(ROOT, f)));
}

export function read(file) {
  return readFileSync(join(ROOT, file), "utf8");
}

// Built from the code point so this file never contains the character itself.
export const EM_DASH = String.fromCodePoint(0x2014);
export const EN_DASH = String.fromCodePoint(0x2013);

/** Lines containing an em dash, as `{line, text}`. */
export function findEmDashes(text) {
  return text
    .split("\n")
    .map((t, i) => ({ line: i + 1, text: t }))
    .filter((l) => l.text.includes(EM_DASH));
}

const CDN = [
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /<link[^>]+href=["']https?:\/\//i,
  /<script[^>]+src=["']https?:\/\//i,
  /@import\s+url\(\s*["']?https?:/i,
  /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/,
];

/**
 * Lines that import a Node built-in at run time, `await import("node:stream")`. Bundled,
 * that becomes a stand-in namespace that copies names only from an object, and some
 * built-ins (node:stream) export a function, so the names come back undefined. One
 * marked webpackIgnore is left to Node, which has the names, so it is not counted.
 */
export function findDynamicNodeImports(text) {
  return text
    .split("\n")
    .map((t, i) => ({ line: i + 1, text: t.trim() }))
    .filter((l) => /\bimport\s*\(\s*["']node:/.test(l.text));
}

/** Lines that load code, styles or fonts from a third-party origin. */
export function findCdnReferences(text) {
  return text
    .split("\n")
    .map((t, i) => ({ line: i + 1, text: t.trim() }))
    .filter((l) => CDN.some((re) => re.test(l.text)));
}
