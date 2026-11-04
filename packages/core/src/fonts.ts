// The family name and weight of a font file, read from its own tables. A
// filename lies ("final-FINAL2.ttf", or a Google Fonts hash); the name table does
// not. Handles sfnt (ttf, otf), woff and woff2.

import { brotliDecompressSync, inflateSync } from "node:zlib";

function sfntTables(buf: Buffer): Map<string, Buffer> {
  const tables = new Map<string, Buffer>();
  const n = buf.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const tag = buf.toString("latin1", o, o + 4);
    const off = buf.readUInt32BE(o + 8);
    const len = buf.readUInt32BE(o + 12);
    tables.set(tag, buf.subarray(off, off + len));
  }
  return tables;
}

function woffTables(buf: Buffer): Map<string, Buffer> {
  const tables = new Map<string, Buffer>();
  const n = buf.readUInt16BE(12);
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    const tag = buf.toString("latin1", o, o + 4);
    const off = buf.readUInt32BE(o + 4);
    const comp = buf.readUInt32BE(o + 8);
    const orig = buf.readUInt32BE(o + 12);
    const raw = buf.subarray(off, off + comp);
    tables.set(tag, comp < orig ? inflateSync(raw) : raw);
  }
  return tables;
}

// woff2 names its common tables by index, in this order (the WOFF2 spec, table 1).
const WOFF2_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

/**
 * woff2 keeps every table in one brotli stream, after a directory in its own format.
 * Only glyf, loca and hmtx are ever transformed, so name and OS/2 come out as plain
 * sfnt tables. Collections are left to the filename.
 */
function woff2Tables(buf: Buffer): Map<string, Buffer> {
  const tables = new Map<string, Buffer>();
  if (buf.toString("latin1", 4, 8) === "ttcf") return tables;
  const n = buf.readUInt16BE(12);
  const compressed = buf.readUInt32BE(20);
  let o = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) { const b = buf[o++]; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; }
    throw new Error("bad woff2 length");
  };
  const dir: { tag: string; len: number; transformed: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const flags = buf[o++];
    const tag = (flags & 0x3f) === 63 ? buf.toString("latin1", o, (o += 4)) : WOFF2_TAGS[flags & 0x3f];
    const orig = base128();
    // glyf and loca are transformed unless they say otherwise; every other table, only when it says so.
    const transformed = tag === "glyf" || tag === "loca" ? flags >> 6 === 0 : flags >> 6 !== 0;
    dir.push({ tag, len: transformed ? base128() : orig, transformed });
  }
  const total = dir.reduce((a, t) => a + t.len, 0);
  const data = brotliDecompressSync(buf.subarray(o, o + compressed), { maxOutputLength: total });
  let at = 0;
  for (const t of dir) { if (!t.transformed) tables.set(t.tag, data.subarray(at, at + t.len)); at += t.len; }
  return tables;
}

// A variable font's family is every weight of it, so a weight or optical size at the
// end of its name belongs to its default instance ("Archivo SemiBold" is Archivo).
const INSTANCE = /(?:\s+(?:\d+pt|thin|hairline|extra ?light|ultra ?light|light|book|regular|normal|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|black|heavy))+$/i;

function nameOf(table: Buffer, id: number): string | undefined {
  const count = table.readUInt16BE(2);
  const strOff = table.readUInt16BE(4);
  let best: string | undefined;
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    const platform = table.readUInt16BE(o);
    const nameId = table.readUInt16BE(o + 6);
    if (nameId !== id) continue;
    const len = table.readUInt16BE(o + 8);
    const off = strOff + table.readUInt16BE(o + 10);
    const raw = table.subarray(off, off + len);
    const s = platform === 3 || platform === 0 ? Buffer.from(raw).swap16().toString("utf16le") : raw.toString("latin1");
    if (s.trim()) { best = s.trim(); if (platform === 3) return best; }
  }
  return best;
}

export function readFont(buf: Buffer): { family?: string; weight?: number } | null {
  try {
    const sig = buf.toString("latin1", 0, 4);
    let tables: Map<string, Buffer>;
    if (sig === "wOFF") tables = woffTables(buf);
    // A woff2 that will not open is still a font; its name falls back to the one it was given.
    else if (sig === "wOF2") { try { tables = woff2Tables(buf); } catch { return {}; } }
    else if (sig === "OTTO" || sig === "true" || buf.readUInt32BE(0) === 0x00010000) tables = sfntTables(buf);
    else return null;
    const name = tables.get("name");
    const os2 = tables.get("OS/2");
    const typographic = name && nameOf(name, 16);
    const legacy = name && nameOf(name, 1);
    const family = typographic ?? (legacy && tables.has("fvar") ? legacy.replace(INSTANCE, "") || legacy : legacy);
    return { family, weight: os2 && os2.length >= 6 ? os2.readUInt16BE(4) : undefined };
  } catch {
    return null;
  }
}
