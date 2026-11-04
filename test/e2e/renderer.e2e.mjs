// A new computer, without the browser knitting draws with: the Knit dialog and Settings,
// About offer to download it, and say how the download is going. The studio's browser
// folder is empty, and its downloads go to a closed port, so nothing big is ever fetched:
// a failure is real, from Playwright's own installer, and a download that works is acted
// out in the page. test/browser-download.test.mjs checks the installer in the built server.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { axeProblems, launchBrowser, startStudio } from "./harness.mjs";

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

test("the Knit dialog offers the browser first, and Knit waits for it", async () => {
  assert.equal((await j("GET", "/api/renderer")).body.ready, false, "this studio has no browser to knit with");
  // The download is acted out from before the dialog opens, a step at a time (the card asks
  // every second), so a slow answer from the real server never lands after a made-up one.
  let now = null;
  await page.route("**/api/renderer", (r) => {
    if (r.request().method() !== "POST") return r.fulfill({ json: { ready: now?.state === "done", install: now } });
    now = { state: "running", progress: null };
    return r.fulfill({ status: 202, json: now });
  });
  try {
    await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`);
    await page.getByRole("application", { name: "Pattern canvas" }).waitFor();
    await page.getByRole("button", { name: "Knit", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const card = dialog.getByRole("region", { name: "Browser for knitting" });
    await card.getByRole("button", { name: "Download it" }).waitFor();
    assert.ok(await dialog.getByRole("button", { name: "Knit 1 file" }).isDisabled(), "Knit cannot work yet, so it cannot be pressed");
    // Measured half faded in (--t-panel is 320ms), the colours are not the ones anyone reads.
    await page.waitForTimeout(400);
    assert.deepEqual(await axeProblems(page), []);

    await card.getByRole("button", { name: "Download it" }).click();
    await card.getByText("Starting the download...").waitFor();
    assert.ok(await card.getByRole("button", { name: "Downloading..." }).isDisabled(), "one download at a time");
    await card.getByRole("progressbar", { name: "Downloading the browser for knitting" }).waitFor();
    now = { state: "running", progress: 0.5 };
    await card.getByText("Downloading, 50%").waitFor();
    assert.equal(await card.getByRole("progressbar").getAttribute("aria-valuenow"), "50");
    now = { state: "done", progress: 1 };
    await card.getByText("Installed. Knitting is ready.").waitFor();
    await page.getByText("The browser for knitting is ready.").waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Knit 1 file" }).isDisabled(), false);
  } finally { await page.unroute("**/api/renderer"); }
});

test("a download that cannot connect says why, and can be tried again", async () => {
  await page.goto(`${studio.url}/settings`);
  await page.getByRole("tab", { name: "About" }).click();
  await page.getByText(`Version ${version}`, { exact: true }).waitFor();
  const card = page.getByRole("region", { name: "Browser for knitting" });
  await card.getByText(/Knitting, which makes the files you post/).waitFor();
  await card.getByRole("button", { name: "Download it" }).click();
  // Playwright's own installer, run by the server, against a port nothing listens on.
  const alert = card.getByRole("alert");
  await alert.waitFor({ timeout: 60_000 });
  assert.match(await alert.textContent(), /^The download did not finish: connect ECONNREFUSED 127\.0\.0\.1:9\. Check your internet connection and try again\.$/);
  assert.equal(await card.getByRole("button", { name: "Download it" }).isDisabled(), false);
  assert.deepEqual((await j("GET", "/api/renderer")).body.ready, false);
  assert.deepEqual(await axeProblems(page), []);
});
