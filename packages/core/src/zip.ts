// A streaming ZIP writer using the "stored" method (no compression).
//
// Knitted outputs are PNG, JPEG, WebP and H.264: already compressed, so
// compressing again wastes CPU for nothing. Stored zips stream with a constant
// small memory footprint (a 2GB batch is not a 2GB buffer) and need no
// dependency. Uses data descriptors so sizes and CRCs can follow the data.

import { createReadStream } from "node:fs";

const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

function dosTime(d: Date): [number, number] {
  return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
}

export interface ZipEntry { name: string; path: string; }

/** Entry names are written as given; callers are responsible for making them safe (no leading slash, no ..). */
export async function* zipChunks(entries: ZipEntry[]): AsyncGenerator<Buffer> {
  const central: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const [time, date] = dosTime(now);
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const header = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0808), u16(0), u16(time), u16(date), u32(0), u32(0), u32(0), u16(name.length), u16(0), name]);
    yield header; const localOffset = offset; offset += header.length;
    let crc = 0, size = 0;
    for await (const chunk of createReadStream(e.path)) { const b = chunk as Buffer; crc = crc32(b, crc); size += b.length; offset += b.length; yield b; }
    const desc = Buffer.concat([u32(0x08074b50), u32(crc), u32(size), u32(size)]);
    yield desc; offset += desc.length;
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0808), u16(0), u16(time), u16(date), u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(localOffset), name]));
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) { yield c; cdSize += c.length; }
  yield Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0)]);
}

export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  const it = zipChunks(entries);
  return new ReadableStream({ async pull(controller) { const { value, done } = await it.next(); if (done) controller.close(); else controller.enqueue(value); }, async cancel() { await it.return(undefined); } });
}
