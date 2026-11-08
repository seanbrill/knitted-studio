// What a voice should not say. A voiceover is heard once, at speed: a command, a path or a
// file name read out letter for letter is noise. Real reels had the voice read "sites live
// my-site 3" as the same command typed on screen, and the person asked for "rollback quickly
// using the CLI" instead. The words on screen and the words said are different jobs.

import type { Pattern } from "./types.ts";

/** Code-shaped words: a flag, a path, a file name, snake_case or camelCase, a shell prompt. */
const CODE = [
  /(^|\s)--?[a-z][\w-]*/i,              // --force, -v
  /(^|\s)[$>#]\s/,                      // a shell prompt
  /[`{}<>]|=>|\(\)/,                    // backticks, braces, arrows, calls
  /(^|[\s(])(~|\.{1,2})?\/[\w.-]+\/?/,  // /usr/bin, ./out, ~/Sites
  /\b[a-z]+\/[a-z][\w.-]*\/[\w.-]+/i,   // a/b/c paths
  /\b\w+\.(html?|css|m?js|ts|tsx|json|ya?ml|toml|sh|py|md|txt|zip|png|jpe?g|svg|mp4|wav|env|conf|lock)\b/i,
  /\b[a-z]+_[a-z0-9_]+\b/i,             // snake_case
  /\b[a-z]+[A-Z][a-zA-Z]+\b/,           // camelCase
];

const words = (s: string) => s.toLowerCase().replace(/\*/g, "").match(/[\p{L}\p{N}][\p{L}\p{N}._\/:@~-]*/gu) ?? [];

/**
 * Why a line should not be said as written, or null. `shown` is text the frame shows as code:
 * a monospace or typed-on stitch. Saying two or more of its words in a row is reading it out.
 */
export function spokenProblem(said: string, shown: string[] = []): string | null {
  const text = said.trim();
  if (!text) return null;
  const w = words(text);
  for (const s of shown) {
    const sw = words(s);
    if (sw.length < 2) continue;
    const joined = ` ${sw.join(" ")} `;
    const n = Math.min(3, sw.length);
    for (let i = 0; i + n <= w.length; i++) {
      const run = w.slice(i, i + n).join(" ");
      if (joined.includes(` ${run} `)) return `The voice reads out "${run}" from the command typed on screen. Nobody can follow a command by ear: say what it does, like "roll it back from the terminal", and leave the command on screen to read.`;
    }
  }
  const hit = CODE.map((re) => text.match(re)).find(Boolean);
  if (hit) {
    const at = text.indexOf(hit[0].trim());
    const token = text.slice(Math.max(0, text.lastIndexOf(" ", at - 1) + 1), (text.indexOf(" ", at + hit[0].trim().length) + 1 || text.length + 1) - 1);
    return `The voice reads out "${token.slice(0, 40)}", which is code. Said aloud it is noise: say what it does in plain words, and show the exact text on screen.`;
  }
  return null;
}

/** The text a pattern shows as code: monospace stitches, and typed-on ones that read as code. */
export function codeOnScreen(p: Pattern): string[] {
  const mono = (f: unknown) => f === "$font.mono" || /mono|code/i.test(String(f ?? ""));
  const typed = (id: string) => (p.motion?.tracks[id] ?? []).some((c) => c.preset === "type-on");
  return p.stitches.filter((s) => s.kind === "text" && s.content && (mono(s.style?.fontFamily) || (typed(s.id) && CODE.some((re) => re.test(String(s.content))))))
    .map((s) => String(s.content));
}
