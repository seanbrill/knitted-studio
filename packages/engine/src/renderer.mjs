// The renderer: something that can open a page at a given size and take frames.
//
// An interface rather than "Playwright", so the engine depends only on the two things
// the frame loop needs, `evaluate` and `screenshot`. Today it is Playwright's headless
// Chromium everywhere. The desktop app does not ship that browser (about 100 MB): it
// downloads it once, when the person says yes in the Knit dialog or Settings, About
// (installBrowser), into PLAYWRIGHT_BROWSERS_PATH, which the shell points at their own
// data folder. The studio's own window draws everything else, so only knitting and model
// previews need it.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

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
    throw new RendererUnavailable(process.env.KNITTED_DESKTOP ? "This copy of knitted is missing the part that starts its browser. Reinstall it from the Download page." : "Knitting needs a browser to draw with. Run `npm i playwright && npx playwright install chromium`, or use the desktop app, which downloads one for you.");
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

/** Why the browser knitting draws with does not start, or null when it does. */
export async function browserProblem() {
  try {
    const r = await openRenderer();
    await r.close();
    return null;
  } catch (e) {
    return String(e?.message ?? e);
  }
}

/**
 * Playwright's own installer, found the way Node finds a package: from the server's
 * folder up. Not through require.resolve, which the studio's bundler would resolve (or
 * fail to) when it builds, not where the app is installed.
 */
export function browserInstaller(from = process.cwd()) {
  for (let d = from; ; d = dirname(d)) {
    const cli = join(d, "node_modules", "playwright-core", "cli.js");
    if (existsSync(cli)) return cli;
    if (dirname(d) === d) return null;
  }
}

/**
 * Download the browser knitting draws with, with Playwright's own installer. Only the
 * headless shell, the part knitting uses. onProgress gets 0 to 1 as it goes (the
 * installer reports every tenth). Rejects with what went wrong (installerError).
 */
export async function installBrowser({ onProgress } = {}) {
  const cli = browserInstaller();
  if (!cli) throw new RendererUnavailable("This copy of knitted has no browser installer. Reinstall it from the Download page.");
  await new Promise((resolve, reject) => {
    // The desktop server runs on Electron's own Node, so the installer does too.
    const child = spawn(process.execPath, [cli, "install", "chromium-headless-shell"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    const keep = (d) => {
      log = (log + d).slice(-4000);
      const pct = [...String(d).matchAll(/(\d+)% of/g)].pop();
      if (pct) onProgress?.(Math.min(1, Number(pct[1]) / 100));
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(installerError(log, code)))));
  });
}

/**
 * What went wrong, from the installer's output. It retries, then wraps the cause
 * ("connect ECONNREFUSED ...") in errors that say only that it failed: the cause is
 * the one worth showing.
 */
export function installerError(log, code) {
  const errors = [...String(log).replace(/\x1b\[[0-9;]*m/g, "").matchAll(/^\s*Error: (.+)$/gm)].map((m) => m[1].trim());
  return errors.filter((e) => !/^(Failed to download|Download failure)/.test(e)).pop() ?? errors.pop() ?? `The installer stopped (${code})`;
}
