// Runs once when the studio's server starts. The scheduler that posts to social accounts at
// their time starts here. In the desktop app it is also where the browser knitting draws
// with starts downloading, if this computer does not have it yet, so it is there by the
// time anyone knits (packages/engine/src/renderer.mjs).

export async function register() {
  // The middleware runs on the edge runtime, which has no engine; this check is decided at build time.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Posts go out at their time while the studio runs (packages/social/src/publish.mjs).
    try {
      const [{ startScheduler }, { getStore }] = await Promise.all([import("@knitted/social"), import("@knitted/core/node")]);
      startScheduler(getStore());
    } catch (e) { console.error("The social scheduler did not start:", (e as Error).message); }
    if (!process.env.KNITTED_DESKTOP) return;
    const { ensureBrowser } = await import("@knitted/engine");
    // Not awaited: the window opens while it downloads. A failure is kept for Settings and the Knit dialog to show.
    ensureBrowser().catch(() => {});
  }
}
