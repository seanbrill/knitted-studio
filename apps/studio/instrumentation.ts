// Runs once when the studio's server starts. In the desktop app that is where the browser
// knitting draws with starts downloading, if this computer does not have it yet, so it is
// there by the time anyone knits (packages/engine/src/renderer.mjs).

export async function register() {
  // The middleware runs on the edge runtime, which has no engine; this check is decided at build time.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!process.env.KNITTED_DESKTOP) return;
    const { ensureBrowser } = await import("@knitted/engine");
    // Not awaited: the window opens while it downloads. A failure is kept for Settings and the Knit dialog to show.
    ensureBrowser().catch(() => {});
  }
}
