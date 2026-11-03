// Turn an HTTP request body into a file on disk without ever holding it in memory.
//
// A 500MB video must not become a 500MB Buffer. The body is piped straight to a
// temp file inside the project's yarn directory, counted as it goes so the size
// limit applies to what actually arrives (a Content-Length can lie), and removed
// if the browser cancels or the connection drops.

import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export class TooLarge extends Error { readonly kind = "validation"; }

export async function bodyToFile(req: Request, tmp: string, maxBytes: number): Promise<number> {
  if (!req.body) throw new TooLarge("That upload had no file in it.");
  const declared = Number(req.headers.get("content-length") ?? 0);
  const limit = `${(maxBytes / 1024 ** 3).toFixed(maxBytes >= 1024 ** 3 ? 0 : 2)}GB`;
  if (declared > maxBytes) throw new TooLarge(`That file is ${(declared / 1024 ** 3).toFixed(1)}GB. The limit is ${limit}; raise it in Settings or trim it first.`);
  await mkdir(dirname(tmp), { recursive: true });
  let got = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      got += chunk.length;
      if (got > maxBytes) cb(new TooLarge(`That file is over the ${limit} limit; raise it in Settings or trim it first.`));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(req.body as never), counter, createWriteStream(tmp), { signal: req.signal });
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return got;
}
