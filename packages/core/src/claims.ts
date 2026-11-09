// The claims check (design sheet f47): what a pattern's words say about the business, read
// beside its Brief. The reading is the person's model's (packages/agent/src/claims.mjs); here
// is what both sides of it share: the words as the model is given them, and where a quote it
// answers with sits on the canvas, so Show it can pick that text and Use this wording can
// put the true way to say it in the quote's place.

import type { Pattern } from "./types.ts";

/** Backed: the Brief says it. Against: it says otherwise. Not yet: planned, in beta, by invitation. Missing: it says nothing. */
export type ClaimVerdict = "backed" | "against" | "notyet" | "missing";
export const CLAIM_VERDICTS: readonly ClaimVerdict[] = ["against", "notyet", "missing", "backed"];

export interface Claim {
  /** The words that make the claim, as they are on the pattern. */
  quote: string;
  verdict: ClaimVerdict;
  /** What the Brief says, in its own words; empty when it says nothing. */
  brief: string;
  /** For the person: how the post and the Brief differ, or what the Brief would need to say. */
  why: string;
  /** The true way to say it, to take the quote's place; null when there is none. */
  fix: string | null;
  /** The text it is in, to pick; null when it is not in one text (an imported page's words). */
  stitchId: string | null;
  /** The quote is in that text exactly once, so the fix can replace it as it is. */
  replaceable: boolean;
}

export interface ClaimsCheck {
  patternId: string;
  claims: Claim[];
  /** The words checked, by text: when they differ from the pattern's now, the check is out of date. */
  words: Record<string, string>;
  model: string;
  checkedAt: string;
}

/** A pattern's words, by text, in the order they are laid out. Hidden texts are not knitted, so not checked. */
export function claimTexts(p: Pick<Pattern, "stitches" | "html">): { id: string; slot?: string; text: string }[] {
  const out: { id: string; slot?: string; text: string }[] = p.stitches.flatMap((s) => (s.kind === "text" && !s.style?.hidden && s.content?.trim() ? [{ id: s.id, slot: s.slot, text: s.content }] : []));
  if (!out.length && p.html) {
    const text = p.html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    if (text) out.push({ id: "", text });
  }
  return out;
}

export const claimWords = (p: Pick<Pattern, "stitches" | "html">): Record<string, string> => Object.fromEntries(claimTexts(p).map((t) => [t.id, t.text]));

/** The words now are the words checked. */
export function sameWords(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => b[k] === a[k]);
}

/** For finding a quote a model copied loosely: emphasis marks, curly quotes, spacing and case let go. */
const loose = (s: string) => s.replace(/[*_]/g, "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
const count = (hay: string, needle: string) => (needle ? hay.split(needle).length - 1 : 0);

/**
 * Where a quote is: the text it is in, and whether it is there exactly once in all the words,
 * which is when its fix can be put in its place. Null when it is not on the pattern at all.
 */
export function placeQuote(words: Record<string, string>, quote: string): { stitchId: string | null; replaceable: boolean } | null {
  const q = quote.trim();
  if (!q) return null;
  const entries = Object.entries(words);
  const exact = entries.filter(([, t]) => t.includes(q));
  const times = exact.reduce((n, [, t]) => n + count(t, q), 0);
  if (exact.length) return { stitchId: exact[0][0] || null, replaceable: times === 1 && !!exact[0][0] };
  const lq = loose(q);
  const near = lq ? entries.find(([, t]) => loose(t).includes(lq)) : undefined;
  return near ? { stitchId: near[0] || null, replaceable: false } : null;
}

/** The text with the fix in the quote's place, or null when the quote is not in it exactly once. */
export function applyFix(text: string, quote: string, fix: string): string | null {
  return count(text, quote) === 1 ? text.replace(quote, () => fix) : null;
}
