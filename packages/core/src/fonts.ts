// The family name and weight of a font file, read from its own tables. A
// filename lies ("final-FINAL2.ttf"); the name table does not. Handles sfnt
// (ttf, otf) and woff. woff2 is brotli-compressed and falls back to the filename.

import { inflateSync } from "node:zlib";

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
    else if (sig === "wOF2") return {};
    else if (sig === "OTTO" || sig === "true" || buf.readUInt32BE(0) === 0x00010000) tables = sfntTables(buf);
    else return null;
    const name = tables.get("name");
    const os2 = tables.get("OS/2");
    return { family: name ? (nameOf(name, 16) ?? nameOf(name, 1)) : undefined, weight: os2 && os2.length >= 6 ? os2.readUInt16BE(4) : undefined };
  } catch {
    return null;
  }
}
