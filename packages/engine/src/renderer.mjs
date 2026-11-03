// The renderer: something that can open a page at a given size and take frames.
//
// An interface rather than "Playwright", because the desktop app renders with
// Electron's own Chromium (no 300MB browser download for a non-technical user)
// while development and the CLI use Playwright. Both give the engine the same
// two things, `evaluate` and `screenshot`, which is all the frame loop needs.

export class RendererUnavailable extends Error { constructor(m) { super(m); this.kind = "renderer_unavailable"; } }

// Chromium flags that remove sources of drift between machines and runs.
// Software rasterisation and no font hinting mean the same pixels everywhere,
// which is what lets a knit be compared byte for byte.
const DETERMINISTIC_ARGS = [
  "--force-color-profile=srgb", "--disable-gpu", "--font-render-hinting=none", "--disable-lcd-text",
  "--disable-font-subpixel-positioning", "--disable-skia-runtime-opts", "--hide-scrollbars", "--allow-file-access-from-files",
];

/** @returns {Promise<{ backend: string, newPage(o: {width:number,height:number,scale?:number}): Promise<any>, close(): Promise<void> }>} */
export async function openRenderer({ backend = "playwright" } = {}) {
  if (backend !== "playwright") throw new RendererUnavailable(`Unknown renderer "${backend}".`);
  let chromium;
  try {
    ({ chromium } = await import(/* webpackIgnore: true */ "playwright"));
  } catch {
    throw new RendererUnavailable("Knitting needs a browser to draw with. Run `npm i playwright && npx playwright install chromium`, or use the desktop app, which includes one.");
  }
  let browser;
  try {
    browser = await chromium.launch({ args: DETERMINISTIC_ARGS });
  } catch (e) {
    if (/Executable doesn't exist|browserType\.launch/i.test(String(e?.message))) {
      throw new RendererUnavailable(process.env.KNITTED_DESKTOP ? "knitted needs to download its browser before it can knit. Open Settings, then About, and press Download it." : "knitted could not find its browser. Run `npx playwright install chromium`, then try again.");
    }
    throw e;
  }
  return {
    backend: "playwright",
    async newPage({ width, height, scale = 1 }) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
      const page = await context.newPage();
      const close = page.close.bind(page);
      page.close = async () => { await close(); await context.close(); };
      return page;
    },
    async close() { await browser.close(); },
  };
}
