// Prefixed, sortable ids: `pj_01HX...`. The prefix says what it is when one
// turns up in a log, and the time prefix makes them sort by creation.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

export type IdPrefix = "pj" | "pt" | "yn" | "sw" | "rv" | "ac" | "jb" | "kn" | "pa" | "ch" | "us" | "sa" | "sp" | "ds";

export function newId(prefix: IdPrefix, now = Date.now()): string {
  let t = "";
  for (let n = now, i = 0; i < 10; i++, n = Math.floor(n / 32)) t = ALPHABET[n % 32] + t;
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let r = "";
  for (const b of bytes) r += ALPHABET[b % 32];
  return `${prefix}_${t}${r}`;
}
