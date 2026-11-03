import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fontPath, manifest } from "@knitted/fonts";
import { fail } from "@/lib/server";

// Only files in the manifest are served, so this cannot be pointed at anything else.
export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const file = basename((await params).file);
  if (!manifest.some((f: { file: string }) => f.file === file)) return fail(404, "not_found", "That font is not bundled.");
  return new Response(readFileSync(fontPath(file)), { headers: { "content-type": "font/woff2", "cache-control": "public, max-age=31536000, immutable" } });
}
