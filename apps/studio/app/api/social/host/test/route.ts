import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SocialError, hostFor, testHost } from "@knitted/social";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

// A one-pixel PNG: small, and a picture, as what Instagram and Threads will fetch is.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

/** Put a file on the media host, read it back from its public address, and take it away. */
export const POST = route(async () => {
  const s = store();
  const host = await hostFor(s);
  if (!host) throw new SocialError("Pick a media host first.");
  const dir = join(s.paths.cacheDir, "social");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `probe-${Date.now()}.png`);
  await writeFile(file, PIXEL);
  try { return ok(await testHost(host, file, "image/png")); }
  finally { await rm(file, { force: true }); }
});
