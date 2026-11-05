import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { axeProblems, launchBrowser, startStudio } from "./harness.mjs";

let studio, browser, page;
before(async () => {
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("the first paint is the light theme", async () => {
  await page.goto(studio.url);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "day");
});

test("the theme toggle switches to Night and survives a reload without a flash", async () => {
  await page.goto(studio.url);
  await page.getByRole("button", { name: /switch to night/i }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "night");
  // The head script must have set it before the body was even parsed, so there
  // is no frame of the wrong theme. Record it at DOMContentLoaded, before React
  // hydrates and could mask the problem.
  const ctx = page.context();
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => {
    document.addEventListener("readystatechange", () => {
      if (document.body && window.__atBody === undefined) window.__atBody = document.documentElement.getAttribute("data-theme");
    });
    document.addEventListener("DOMContentLoaded", () => { window.__atDcl = document.documentElement.getAttribute("data-theme"); });
  });
  await p2.goto(studio.url);
  assert.equal(await p2.evaluate(() => window.__atDcl), "night");
  await p2.close();
  await page.getByRole("button", { name: /switch to day/i }).click();
});

test("Cmd/Ctrl+K opens the palette and navigates", async () => {
  await page.goto(studio.url);
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/search pages/i).fill("settings");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/settings/);
  assert.match(await page.locator("h1").textContent(), /Make it yours/);
});

test("the app works with the network off (nothing is fetched from elsewhere)", async () => {
  const external = [];
  page.on("request", (r) => { if (!r.url().startsWith(studio.url) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) external.push(r.url()); });
  await page.goto(studio.url);
  await page.waitForLoadState("load");
  await page.waitForTimeout(800);
  assert.deepEqual(external, []);
});

for (const theme of ["day", "night"]) {
  for (const path of ["/", "/projects", "/ask", "/settings", "/kit"]) {
    test(`no serious accessibility violations on ${path} in ${theme}`, async () => {
      await page.goto(studio.url + path);
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForTimeout(150);
      assert.deepEqual(await axeProblems(page), []);
    });
  }
}

test("every unbuilt area shows an intentional empty state, never a blank page", async () => {
  await page.goto(studio.url + "/projects");
  assert.ok((await page.locator("main").innerText()).trim().length > 20);
  const res = await page.goto(studio.url + "/definitely-not-a-page");
  assert.equal(res.status(), 404);
  assert.match(await page.locator("body").innerText(), /not here/i);
});
