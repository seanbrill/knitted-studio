// A new computer, without the browser knitting draws with: the desktop app downloads it by
// itself when it starts, the Knit dialog and Settings, About say how that is going, and a
// download that failed can be tried again. The studio's browser folder is empty, and its
// downloads go to a closed port, so nothing big is ever fetched: a failure is real, from
// Playwright's own installer, and a download that works is acted out in the page.
// test/browser-download.test.mjs checks the installer in the built server.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, page, browsers, projectId, patternId;
const { version } = JSON.parse(await readFile(new URL("../../apps/studio/package.json", import.meta.url), "utf8"));
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  browsers = await mkdtemp(join(tmpdir(), "knitted-no-browser-"));
  studio = await startStudio({ env: { PLAYWRIGHT_BROWSERS_PATH: browsers, PLAYWRIGHT_DOWNLOAD_HOST: "http://127.0.0.1:9", KNITTED_DESKTOP: "1" } });
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "No browser", starter: "social" })).body.id;
  patternId = (await j("GET", `/api/projects/${projectId}/patterns`)).body[0].id;
});
after(async () => { await browser?.close(); await studio?.stop(); await rm(browsers, { recursive: true, force: true }); });

test("the Knit dialog shows the browser downloading by itself, and Knit waits for it", async () => {
  // The download a new computer starts when the app opens, acted out a step at a time (the
  // card asks every second), so a slow answer from the real server never lands after a made-up one.
  let now = { state: "running", progress: null };
  await page.route("**/api/renderer", (r) => r.fulfill({ json: { ready: now.state === "done", install: now } }));
  try {
    await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`);
    await page.getByRole("application", { name: "Pattern canvas" }).waitFor();
    await page.getByRole("button", { name: "Knit", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const card = dialog.getByRole("region", { name: "Browser for knitting" });
    await card.getByText("Starting the download...").waitFor();
    await card.getByText(/knitted is downloading it now/).waitFor();
    assert.equal(await card.getByRole("button").count(), 0, "nobody has to press anything");
    assert.ok(await dialog.getByRole("button", { name: "Knit 1 file" }).isDisabled(), "Knit cannot work yet, so it cannot be pressed");
    // Measured half faded in (--t-panel is 320ms), the colours are not the ones anyone reads.
    await page.waitForTimeout(400);
    assert.deepEqual(await axeProblems(page), []);
    now = { state: "running", progress: 0.5 };
    await card.getByText("Downloading, 50%").waitFor();
    assert.equal(await card.getByRole("progressbar", { name: "Downloading the browser for knitting" }).getAttribute("aria-valuenow"), "50");
    now = { state: "done", progress: 1 };
    await card.getByText("Installed. Knitting is ready.").waitFor();
    await page.getByText("The browser for knitting is ready.").waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Knit 1 file" }).isDisabled(), false);
  } finally { await page.unroute("**/api/renderer"); }
});

// The real thing: Playwright's own installer, started by the server when it started, against a port nothing listens on.
const REFUSED = "knitted could not download its browser: connect ECONNREFUSED 127.0.0.1:9. Check the internet connection and try again.";

test("the download starts when the app does, and one that cannot connect says why and can be tried again", async () => {
  const first = await serverHas(studio, "/api/renderer", (r) => r.install?.state === "failed", { timeout: 90_000 });
  assert.deepEqual(first, { ready: false, install: { state: "failed", progress: null, error: REFUSED } }, "nothing asked for it: the server started it");
  await page.goto(`${studio.url}/settings`);
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: /^About\b/ }).click();
  await page.getByText(`Version ${version}`, { exact: true }).waitFor();
  const card = page.getByRole("region", { name: "Browser for knitting" });
  await card.getByText(/Knitting, which makes the files you post/).waitFor();
  assert.equal(await card.getByRole("alert").textContent(), REFUSED);
  assert.deepEqual(await axeProblems(page), []);
  await card.getByRole("button", { name: "Try again" }).click();
  await card.getByText(/knitted is downloading it now/).waitFor();
  await card.getByRole("alert").waitFor({ timeout: 90_000 });
  assert.equal(await card.getByRole("alert").textContent(), REFUSED);
  await card.getByRole("button", { name: "Try again" }).waitFor();
});

test("a model that wants to see a pattern while the browser is missing gets it downloaded, and is told what failed", async () => {
  const path = (await j("GET", "/api/agent/mcp")).body.path;
  const res = await fetch(studio.url + path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "preview_pattern", arguments: { patternId } } }) });
  const { result } = await res.json();
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, new RegExp(`^${REFUSED.replace(/[.()]/g, "\\$&")} check_pattern still works without it`));
});
