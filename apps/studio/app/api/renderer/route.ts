import { browserStatus, ensureBrowser } from "@knitted/engine";
import { ok, route } from "@/lib/server";

export const dynamic = "force-dynamic";

// The browser knitting draws with is not bundled (about 100 MB). The desktop app downloads
// it by itself when it starts (instrumentation.ts) and whenever something needs to draw;
// this is where Settings, About and the Knit dialog see how that is going, and where Try
// again starts another attempt after one failed. The engine keeps one download at a time.
export const GET = route(async () => ok(await browserStatus()));

export const POST = route(async () => {
  // How it ends is in the status, which the card asks for: the error is not lost here.
  ensureBrowser().catch(() => {});
  return ok(await browserStatus(), 202);
});
