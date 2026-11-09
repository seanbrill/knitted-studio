// Prove the two build outputs actually work.
//
//   node scripts/verify-builds.mjs              verify dist/site and dist/app
//   node scripts/verify-builds.mjs --self-test  prove the checks FAIL on bad output
//
// A check that cannot fail is decoration (the brief: "prove a check fails on
// its own bug before trusting it"), so --self-test feeds the same checks a
// deliberately broken site and requires every one to reject it.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, stat, mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".txt": "text/plain" };

async function exists(p) { return stat(p).then(() => true, () => false); }

function serveStatic(dir) {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = join(dir, p);
    if (!file.startsWith(dir) || !(await exists(file))) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

async function loadChromium() {
  try { return (await import("playwright")).chromium; }
  catch { throw new Error("verify-builds needs Playwright: npm i playwright && npx playwright install chromium"); }
}

/** Every check returns a list of problems; empty means it passed. */
async function checkSite(dir, { expectH1, warnings = [] }) {
  const problems = [];
  if (!(await exists(join(dir, "index.html")))) return [`${dir}/index.html is missing`];

  // A static site must not carry a Node server.
  for (const bad of ["server.js", ".next", "node_modules"]) {
    if (await exists(join(dir, bad))) problems.push(`static output contains ${bad}`);
  }

  const chromium = await loadChromium();
  const browser = await chromium.launch();
  try {
    // 1. Over a plain static server: how it will be deployed.
    const server = await serveStatic(dir);
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("requestfailed", (r) => errors.push(`request failed: ${r.url()}`));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const h1 = (await page.locator("h1").first().textContent({ timeout: 3000 }).catch(() => null)) ?? "";
      if (!h1.includes(expectH1)) problems.push(`static server: expected h1 containing "${expectH1}", got "${h1}"`);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      if (bg === "rgba(0, 0, 0, 0)") problems.push("static server: body has no background (stylesheet did not load)");
      problems.push(...errors.map((e) => `static server: ${e}`));
      await page.close();
    } finally { server.close(); }

    // 2. Straight from disk by double click. INFORMATIONAL, not a failure:
    // Next's export writes root-absolute asset paths (/_next/...), which any
    // static host serves but file:// cannot. Making them relative would break
    // every page below the root once the site has /docs/ and friends, so the
    // real target is a static server, checked above.
    const page = await browser.newPage();
    const failed = [];
    page.on("requestfailed", (r) => failed.push(r.url()));
    await page.goto(pathToFileURL(join(dir, "index.html")).href);
    if (failed.length) warnings.push(`file:// does not load assets (${failed.length} failed). Expected: deploy to a static host, do not open index.html directly`);
    await page.close();
  } finally { await browser.close(); }
  return problems;
}

// The bundler writes in where each file was on the computer that BUILT the server. Anywhere
// else that path is not there, and on Windows, from a Mac's build, it is not even a path:
// turning it into one throws. That threw as the server started, and the Windows app never
// opened (0.1.43). So the server runs here as if it were on another computer: a file
// address outside the app it is given throws, as Windows throws.
const ELSEWHERE = `const url = require("node:url"), { resolve, sep } = require("node:path");
const inside = resolve(process.env.KNITTED_VERIFY_APP) + sep, real = url.fileURLToPath;
const elsewhere = (what) => Object.assign(new TypeError("File URL path must be absolute (" + what + " is on the computer that built this, not here)"), { code: "ERR_INVALID_FILE_URL_PATH" });
url.fileURLToPath = function (u, ...rest) {
  let p;
  // On Windows a path from a Mac or Linux has no drive, and Node refuses it before this can look.
  try { p = real.call(this, u, ...rest); } catch { throw elsewhere(String(u && u.href ? u.href : u)); }
  if (!p.startsWith(inside)) throw elsewhere(p);
  return p;
};
require("node:module").syncBuiltinESMExports();
`;

async function checkApp(dir) {
  const entry = join(dir, "apps/studio/server.js");
  if (!(await exists(entry))) return [`${entry} is missing`];
  const port = 4300 + Math.floor(Math.random() * 500);
  const preload = join(await mkdtemp(join(tmpdir(), "knitted-elsewhere-")), "elsewhere.cjs");
  await writeFile(preload, ELSEWHERE);
  const child = spawn("node", ["--require", preload, entry], { env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", KNITTED_VERIFY_APP: dir }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const problems = [];
  try {
    let html = "";
    for (let i = 0; i < 50; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) { html = await r.text(); break; } } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!html) return [`server did not answer on :${port}\n${log.slice(-800)}`];
    if (!/knitted/i.test(html)) problems.push("app served a page without the word knitted");
    // Next standalone leaves out static assets; they must have been copied.
    const chunk = html.match(/\/_next\/static\/[^"']+\.js/)?.[0];
    if (!chunk) problems.push("no script tag found in app html");
    else {
      const r = await fetch(`http://127.0.0.1:${port}${chunk}`);
      if (!r.ok) problems.push(`static asset ${chunk} returned ${r.status}: collect-app did not copy .next/static`);
    }
    // Fonts are bundled, not fetched: the stylesheet must reference font files
    // and the server must actually serve them (the offline guarantee).
    const css = html.match(/\/_next\/static\/css\/[^"']+\.css/)?.[0];
    if (!css) problems.push("no stylesheet found in app html");
    else {
      const sheet = await (await fetch(`http://127.0.0.1:${port}${css}`)).text();
      const font = sheet.match(/url\((\/_next\/static\/media\/[^)]+\.woff2)\)/)?.[1];
      if (!font) problems.push("stylesheet references no bundled .woff2 (fonts not self-hosted?)");
      else {
        const r = await fetch(`http://127.0.0.1:${port}${font}`);
        if (!r.ok) problems.push(`bundled font ${font} returned ${r.status}`);
      }
      if (/fonts\.(googleapis|gstatic)\.com/.test(sheet)) problems.push("stylesheet still references Google Fonts");
    }
    // Caught or not: caught, it still stopped something (0.1.43's social scheduler never started on Windows).
    for (const line of new Set(log.split("\n").filter((l) => l.includes("is on the computer that built this")))) problems.push(`read a path from the computer that built it: ${line.trim()}`);
  } finally { child.kill("SIGKILL"); }
  return problems;
}

function report(name, problems) {
  if (problems.length) { console.error(`FAIL ${name}`); problems.forEach((p) => console.error(`  - ${p}`)); return false; }
  console.log(`ok   ${name}`);
  return true;
}

if (process.argv.includes("--self-test")) {
  // Broken fixtures. Each check must reject its own bug.
  const tmp = await mkdtemp(join(tmpdir(), "knitted-verify-"));
  const noH1 = join(tmp, "no-h1"); await mkdir(noH1);
  await writeFile(join(noH1, "index.html"), "<!doctype html><body><p>hi</p></body>");
  const withServer = join(tmp, "with-server"); await mkdir(withServer);
  await writeFile(join(withServer, "index.html"), "<!doctype html><body><h1>Make it knitted.</h1></body>");
  await writeFile(join(withServer, "server.js"), "// a static site must not ship this");
  const emptyApp = join(tmp, "app"); await mkdir(emptyApp);
  // A server that answers, but reads where a file was on the computer that built it as it starts.
  const builtElsewhere = join(tmp, "elsewhere"); await mkdir(join(builtElsewhere, "apps/studio"), { recursive: true });
  await writeFile(join(builtElsewhere, "apps/studio/server.js"), `const { fileURLToPath } = require("node:url");
try { fileURLToPath("file:///build-machine/packages/fonts/src/index.mjs"); } catch (e) { console.error("The social scheduler did not start:", e.message); }
require("node:http").createServer((q, r) => r.end("<h1>knitted</h1>")).listen(Number(process.env.PORT), process.env.HOSTNAME);
`);

  let ok = true;
  for (const [name, fn] of [
    ["site missing its h1 is rejected", () => checkSite(noH1, { expectH1: "Make it knitted." })],
    ["site carrying server.js is rejected", () => checkSite(withServer, { expectH1: "Make it knitted." })],
    ["app dir without a server is rejected", () => checkApp(emptyApp)],
    ["app reading the build computer's paths as it starts is rejected", async () => (await checkApp(builtElsewhere)).filter((p) => p.startsWith("read a path from the computer that built it"))],
  ]) {
    const problems = await fn();
    if (problems.length === 0) { console.error(`SELF-TEST FAIL: ${name} (the check accepted a broken build)`); ok = false; }
    else console.log(`ok   self-test: ${name}`);
  }
  process.exit(ok ? 0 : 1);
}

const warnings = [];
const results = [
  report("dist/site", await checkSite(join(root, "dist/site"), { expectH1: "Make it knitted.", warnings })),
  report("dist/app", await checkApp(join(root, "dist/app"))),
];
warnings.forEach((w) => console.warn(`warn ${w}`));
process.exit(results.every(Boolean) ? 0 : 1);
