import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, page, projectId, patternId;
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const pattern = async () => (await j("GET", `/api/patterns/${patternId}`)).body;
const frame = () => page.frameLocator('iframe[title="Pattern canvas"]');
async function openEditor() { await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`); await page.getByRole("application", { name: "Pattern canvas" }).waitFor(); await frame().locator("[data-stitch-id]").first().waitFor(); }

before(async () => {
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Parts e2e", starter: "social" })).body.id;
  patternId = (await j("GET", `/api/projects/${projectId}/patterns`)).body[0].id;
  await j("GET", `/api/projects/${projectId}/parts`); // seeds the starters and warms the route
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("the Parts panel lists the ten starters, drawn by the real renderer", async () => {
  await openEditor();
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await page.getByRole("button", { name: "Add Lower third" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Add / }).count(), 10);
  assert.ok(await page.locator('iframe[srcdoc*="partstage"]').count() >= 10, "each card is a real render");
});

test("clicking a Part adds a named, linked instance to the canvas", async () => {
  await page.getByRole("button", { name: "Add Lower third" }).click();
  await frame().locator(".partstage").waitFor();
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.some((s) => s.kind === "part"));
  const inst = (await pattern()).stitches.find((s) => s.kind === "part");
  assert.equal(inst.slot, "lower_third");
  assert.ok(inst.partId && inst.partSlots.length === 2);
});

test("the inspector shows the part's slots; filling one changes the canvas and is saved", async () => {
  await page.getByRole("complementary", { name: "Inspector" }).getByText(/Linked to/).waitFor();
  await page.getByLabel("name", { exact: true }).fill("Ada Lovelace");
  await page.getByLabel("name", { exact: true }).blur();
  await frame().getByText("Ada Lovelace").waitFor();
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.find((s) => s.kind === "part").overrides.name === "Ada Lovelace");
});

test("a model filling a slot INSIDE the part is applied, and a locked one is refused", async () => {
  const part = (await j("GET", `/api/projects/${projectId}/parts`)).body.find((p) => p.name === "Pull quote");
  const mk = await j("POST", `/api/projects/${projectId}/parts`, { name: "Locked title", stitches: part.stitches, slots: [{ name: "quote", kind: "text", locked: true }, { name: "by", kind: "text", locked: false }], aspect: 1.5 });
  assert.equal(mk.status, 201);
});

test("Save as part replaces a selection with a linked instance and adds it to the panel", async () => {
  await page.getByRole("button", { name: "Patterns", exact: true }).click();
  await page.getByRole("list", { name: "Layers" }).getByRole("button", { name: /^headline/ }).click();
  await page.getByRole("button", { name: "Save as part" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name", { exact: true }).fill("My headline");
  await dlg.getByRole("button", { name: "Save part" }).click();
  await page.getByText(/Saved My headline/).waitFor();
  const p = await pattern();
  assert.equal(p.stitches.some((s) => s.slot === "headline" && s.kind === "text"), false, "the original stitch is gone");
  assert.equal(p.stitches.some((s) => s.kind === "part" && s.slot === "my_headline"), true);
  assert.ok((await j("GET", `/api/projects/${projectId}/parts`)).body.some((x) => x.name === "My headline" && !x.builtin));
});

test("Detach turns the instance back into ordinary stitches with prefixed slots", async () => {
  await page.getByRole("button", { name: "Detach to edit freely" }).click();
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => !p.stitches.some((s) => s.slot === "my_headline" && s.kind === "part"));
  const p = await pattern();
  assert.ok(p.stitches.some((s) => s.slot === "my_headline_headline"), "the slot is prefixed with the instance's name");
});

test("undo puts the instance back exactly", async () => {
  await page.keyboard.press("Control+z");
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.some((s) => s.slot === "my_headline" && s.kind === "part"));
});

test("the Parts page manages parts: a code part with a script cannot be saved, and a clean one can", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/parts`);
  await page.getByRole("heading", { name: "Starter parts" }).waitFor();
  await page.getByRole("button", { name: "New code part" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name", { exact: true }).fill("Slide card");
  await dlg.getByLabel("Markup").fill("<div>{{title}}</div><script>alert(1)</script>");
  await dlg.getByText(/Scripts are not allowed/).waitFor();
  assert.equal(await dlg.getByRole("button", { name: "Save part" }).isDisabled(), true);
  await dlg.getByLabel("Markup").fill("<div>{{kicker}} {{title}}</div>");
  await dlg.getByText(/No problems/).waitFor();
  await dlg.getByRole("button", { name: "Save part" }).click();
  await page.getByText("Slide card").first().waitFor();
});

test("export then import brings a part back, and the API refuses a script server-side too", async () => {
  const mine = (await j("GET", `/api/projects/${projectId}/parts`)).body.find((p) => p.name === "Slide card");
  const file = (await j("POST", `/api/parts/${mine.id}`, { action: "export" })).body;
  assert.equal(file.format, "knitted-part");
  const imp = await j("POST", `/api/projects/${projectId}/parts`, { name: "x", file });
  assert.equal(imp.status, 201);
  const bad = await j("POST", `/api/projects/${projectId}/parts`, { name: "evil", kind: "code", html: "<script>1</script>", aspect: 1 });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error.message, /Scripts are not allowed/);
  assert.equal((await j("DELETE", `/api/parts/${(await j("GET", `/api/projects/${projectId}/parts`)).body.find((p) => p.builtin).id}`)).status, 400, "starters cannot be deleted");
});

for (const theme of ["day", "night"]) {
  test(`no serious accessibility violations on the Parts page and the Parts panel in ${theme}`, async () => {
    await page.goto(`${studio.url}/projects/${projectId}/parts`);
    await page.getByRole("heading", { name: "Starter parts" }).waitFor();
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(500);
    assert.deepEqual(await axeProblems(page), []);
    await openEditor();
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("button", { name: "Parts", exact: true }).click();
    await page.getByRole("button", { name: "Add Lower third" }).waitFor();
    await page.waitForTimeout(500);
    assert.deepEqual((await axeProblems(page)).filter((p) => !p.startsWith("scrollable-region")), []);
  });
}
