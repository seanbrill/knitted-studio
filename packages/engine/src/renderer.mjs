// The renderer: something that can open a page at a given size and take frames.
//
// An interface rather than "Playwright", so the engine depends only on the two things
// the frame loop needs, `evaluate` and `screenshot`. Today it is Playwright's headless
// Chromium everywhere. The desktop app does not ship that browser (about 100 MB, and a
// different one for every system): it downloads it by itself, once, the first time it
// starts (ensureBrowser, from instrumentation.ts), into PLAYWRIGHT_BROWSERS_PATH, which
// the shell points at the person's own data folder. The studio's own window draws
// everything else, so only knitting and model previews need it.

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

/** The browser, started; or a RendererUnavailable saying why not, `missing` when it is only not downloaded yet. */
async function launch() {
  let chromium;
  try {
    ({ chromium } = await import(/* webpackIgnore: true */ "playwright"));
  } catch {
    throw new RendererUnavailable(process.env.KNITTED_DESKTOP ? "This copy of knitted is missing the part that starts its browser. Reinstall it from the Download page." : "Knitting needs a browser to draw with. Run `npm i playwright && npx playwright install chromium`, or use the desktop app, which downloads one for you.");
  }
  try {
    return await chromium.launch({ args: DETERMINISTIC_ARGS });
  } catch (e) {
    if (/Executable doesn't exist/i.test(String(e?.message))) {
      throw Object.assign(new RendererUnavailable(process.env.KNITTED_DESKTOP ? "knitted needs to download its browser before it can knit." : "knitted could not find its browser. Run `npx playwright install chromium`, then try again."), { missing: true });
    }
    if (/browserType\.launch/i.test(String(e?.message))) throw new RendererUnavailable(`knitted's browser would not start: ${clause(String(e.message).replace(/^browserType\.launch:\s*/, "").split("\n")[0])}.`);
    throw e;
  }
}
const clause = (s) => String(s).trim().replace(/\.$/, "");

/**
 * Open the renderer. In the desktop app a browser that is not there yet is downloaded
 * first (ensureBrowser), so a knit or a preview waits for it rather than failing.
 * @returns {Promise<{ backend: string, newPage(o: {width:number,height:number,scale?:number}): Promise<any>, close(): Promise<void> }>}
 */
export async function openRenderer({ backend = "playwright" } = {}) {
  if (backend !== "playwright") throw new RendererUnavailable(`Unknown renderer "${backend}".`);
  let browser;
  try {
    browser = await launch();
  } catch (e) {
    if (!(e?.missing && process.env.KNITTED_DESKTOP)) throw e;
    await ensureBrowser();
    browser = await launch();
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

/** Why the browser knitting draws with does not start, or null when it does. Never downloads it. */
export async function browserProblem() {
  return (await launchProblem())?.message ?? null;
}
async function launchProblem() {
  try {
    await (await launch()).close();
    return null;
  } catch (e) {
    return e instanceof RendererUnavailable ? e : new RendererUnavailable(String(e?.message ?? e));
  }
}

// One download at a time for the whole server. Each of the studio's routes is bundled on
// its own, with its own copy of this module, so where it stands is kept on globalThis.
const shared = () => (globalThis.__knittedBrowser ??= { ready: false, install: null, pending: null, looking: null });

/** Whether the browser starts, and how its download is going: what Settings and the Knit dialog show. */
export async function browserStatus() {
  const s = shared();
  if (!s.ready && !s.pending) s.ready = !(await launchProblem());
  // ensureBrowser is still finding out whether it has to download: a second, not a download.
  else if (s.looking) await s.looking;
  return { ready: s.ready, install: s.install && { state: s.install.state, progress: s.install.progress, ...(s.install.error ? { error: s.install.error } : {}) } };
}

/**
 * Make sure the browser is there, downloading it when it is missing. The desktop app does
 * this by itself when it starts, and again whenever something needs to draw, so an
 * attempt that failed offline is tried again later. Every caller joins the one download
 * running. Rejects with what went wrong, in words for the person and their model alike.
 */
export function ensureBrowser() {
  const s = shared();
  if (s.ready) return Promise.resolve();
  return (s.pending ??= (async () => {
    try {
      const problem = await (s.looking = launchProblem());
      s.looking = null;
      if (!problem) { s.ready = true; return; }
      // Only a browser that is not there is helped by downloading it.
      if (!problem.missing) throw problem;
      const install = (s.install = { state: "running", progress: null });
      const fail = (message) => { install.state = "failed"; install.progress = null; install.error = message; return new RendererUnavailable(message); };
      try {
        await installBrowser({ onProgress: (p) => { install.progress = p; } });
      } catch (e) {
        throw fail(`knitted could not download its browser: ${clause(e?.message ?? e)}. Check the internet connection and try again.`);
      }
      // Installed is not the same as working: say why if it will not start.
      const after = await launchProblem();
      if (after) throw fail(`knitted downloaded its browser, but it would not start: ${clause(after.message)}.`);
      s.ready = true; install.state = "done"; install.progress = 1;
    } finally {
      s.pending = null;
    }
  })());
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
