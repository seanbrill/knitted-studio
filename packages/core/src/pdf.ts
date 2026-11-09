// PDFs, read and drawn without running anything in them.
//
// PDFium, the library Chrome reads PDFs with, compiled to WebAssembly: the same code on
// every system the app runs on, with no native part to build for each. A PDF's text is
// what a model reads; its pages, drawn, are what a person and a model look at, and what a
// picture for Yarn is cut from. A document is opened for one job and closed after it.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFiumLibrary } from "@hyzyla/pdfium";
import { ValidationError } from "./store.ts";

/** The most pixels on a page's longest side: enough to print a crop of it sharp, little enough to hold. */
export const PDF_MAX_SIDE = 3200;

// Where pdfium.wasm is. In the studio's server import.meta.url is where this file was when the
// server was BUILT (the bundler writes that in), so the server's own node_modules is looked
// in too, from where it runs: apps/studio, two folders below them, in the app and from source.
// On Windows, a path written in on a Mac has no drive and is not a path at all, so it is
// only one guess among the others (packages/fonts/src/index.mjs found that out first).
const WASM = join("node_modules", "@hyzyla", "pdfium", "dist", "pdfium.wasm");
function wasmPath(): string {
  let here: string | undefined;
  try { here = dirname(fileURLToPath(import.meta.url)); } catch { /* built on another system */ }
  const places = [...(here ? [join(here, "..", "..", "..", WASM), join(here, "..", WASM)] : []), join(process.cwd(), "..", "..", WASM), join(process.cwd(), WASM)];
  const found = places.find((p) => existsSync(p));
  if (!found) throw new Error("knitted could not find the part it reads PDFs with. Reinstall the app.");
  return found;
}

let lib: Promise<PDFiumLibrary> | undefined;
function library(): Promise<PDFiumLibrary> {
  lib ??= readFile(wasmPath()).then((wasm) => PDFiumLibrary.init({ wasmBinary: wasm }));
  lib.catch(() => { lib = undefined; });
  return lib;
}

type Doc = Awaited<ReturnType<PDFiumLibrary["loadDocument"]>>;
async function open<T>(buf: Uint8Array, fn: (doc: Doc) => Promise<T> | T): Promise<T> {
  let doc: Doc;
  try { doc = await (await library()).loadDocument(buf); }
  catch (e) {
    if (/password/i.test((e as Error).message)) throw new ValidationError("That PDF is locked with a password. Save a copy without one, and add that.");
    throw new ValidationError("That file is not a PDF knitted can read. It may be damaged, or renamed from something else.");
  }
  try { return await fn(doc); } finally { doc.destroy(); }
}

export interface PdfFacts {
  pages: number;
  /** The first page's size, in points (a 72nd of an inch). */
  width: number;
  height: number;
  /** Each page's text, in order. A page with none is a picture, like a scan. */
  texts: string[];
}

const tidy = (t: string) => t.replace(/\r\n?/g, "\n").replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** How many pages a PDF has, how big the first is, and the text of each. */
export async function readPdf(buf: Uint8Array): Promise<PdfFacts> {
  return open(buf, (doc) => {
    const pages = doc.getPageCount();
    if (!pages) throw new ValidationError("That PDF has no pages.");
    const texts: string[] = [];
    let width = 0, height = 0;
    for (let i = 0; i < pages; i++) {
      const page = doc.getPage(i);
      if (i === 0) { const s = page.getOriginalSize(); width = s.originalWidth; height = s.originalHeight; }
      try { texts.push(tidy(page.getText())); } catch { texts.push(""); }
      page.close();
    }
    return { pages, width, height, texts };
  });
}

/**
 * One page, drawn on white, `maxSide` pixels on its longest side: four bytes a pixel, red,
 * green, blue and alpha, for sharp to encode or cut. `index` counts from 0.
 */
export async function drawPdfPage(buf: Uint8Array, index: number, maxSide: number): Promise<{ data: Buffer; width: number; height: number }> {
  return open(buf, async (doc) => {
    const count = doc.getPageCount();
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new ValidationError(`That PDF has ${count} page${count === 1 ? "" : "s"}. Ask for one from 1 to ${count}.`);
    const page = doc.getPage(index);
    try {
      const { originalWidth: w, originalHeight: h } = page.getOriginalSize();
      const scale = Math.min(PDF_MAX_SIDE, Math.max(16, maxSide)) / Math.max(w, h, 1);
      const r = await page.render({ scale, render: "bitmap", transparent: false });
      return { data: Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength), width: r.width, height: r.height };
    } finally { page.close(); }
  });
}
