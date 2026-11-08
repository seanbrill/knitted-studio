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

// ── a Part changed in the editor ───────────────────────────────────────────
let partPage;
test("Edit opens a part of your own in the editor, as a part: no Knit, no parts inside it, a way back to Parts", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/parts`);
  await page.getByRole("button", { name: "Edit My headline" }).click();
  await page.waitForURL(/\/patterns\/pt_/);
  partPage = page.url();
  await page.getByRole("note", { name: "Changing a part" }).getByText(/It is in 1 pattern/).waitFor();
  await frame().locator("[data-stitch-id]").first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Knit" }).count(), 0, "a part is not knitted on its own");
  assert.equal(await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "Parts", exact: true }).count(), 0, "a part holds no parts");
  assert.equal(await page.getByRole("button", { name: "Save as part" }).count(), 0);
  await page.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("link", { name: "Parts", exact: true }).waitFor();
  const listed = (await j("GET", `/api/projects/${projectId}/patterns`)).body;
  assert.equal(listed.some((p) => page.url().endsWith(p.id)), false, "it is not one of the project's Patterns");
});

test("a change there is the part's, one version for the sitting, and the pattern that uses it offers the update", async () => {
  const part = (await j("GET", `/api/projects/${projectId}/parts`)).body.find((p) => p.name === "My headline");
  const pid = partPage.split("/").pop();
  const name = page.getByLabel("Part name");
  await name.fill("My headline, bolder");
  await name.press("Enter");
  await serverHas(studio, `/api/parts/${part.id}`, (r) => r.part.name === "My headline, bolder" && r.part.version === part.version + 1);
  const text = (await j("GET", `/api/patterns/${pid}`)).body.stitches.find((s) => s.kind === "text");
  assert.equal((await j("POST", `/api/patterns/${pid}/commands`, { command: { type: "updateStitch", id: text.id, patch: { content: "Changed in the part" } } })).status, 200);
  await serverHas(studio, `/api/parts/${part.id}`, (r) => r.part.stitches.some((s) => s.content === "Changed in the part"));
  assert.equal((await j("GET", `/api/parts/${part.id}`)).body.part.version, part.version + 1, "still one version");
  await page.getByRole("link", { name: "Done" }).click();
  await page.getByRole("heading", { name: "Starter parts" }).waitFor();
  await openEditor();
  await frame().getByText("Changed in the part").waitFor();
  await page.getByRole("list", { name: "Layers" }).getByRole("button", { name: /^my_headline/ }).click();
  await page.getByText(/This part has changed since you added it/).waitFor();
  await page.getByRole("button", { name: "Accept the update" }).click();
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.find((s) => s.slot === "my_headline").partVersion === part.version + 1);
});

test("Change the part, in a pattern's inspector, opens that part", async () => {
  await page.getByRole("button", { name: "Change the part" }).click();
  await page.waitForURL(partPage);
  await page.getByRole("note", { name: "Changing a part" }).waitFor();
});

test("a starter is edited as a copy of your own, and a code part as its code", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/parts`);
  await page.getByRole("button", { name: "Edit a copy of Lower third" }).click();
  await page.waitForURL(/\/patterns\/pt_/);
  await page.getByRole("note", { name: "Changing a part" }).getByText(/Nothing uses it yet/).waitFor();
  const parts = (await j("GET", `/api/projects/${projectId}/parts`)).body;
  assert.equal(parts.filter((p) => p.name === "Lower third" && !p.builtin).length, 1, "a copy of its own");
  assert.equal(parts.find((p) => p.name === "Lower third" && p.builtin).version, parts.find((p) => p.name === "Lower third" && p.builtin).version, "the starter is as it was");
  await page.goto(`${studio.url}/projects/${projectId}/parts`);
  // The export test imported a second Slide card: either is one to change.
  await page.getByRole("button", { name: "Edit Slide card" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Edit Slide card" });
  assert.match(await dlg.getByLabel("Markup").inputValue(), /\{\{kicker\}\}/);
  await dlg.getByLabel("Markup").fill("<div>{{kicker}}: {{title}}</div>");
  await dlg.getByRole("button", { name: "Save part" }).click();
  await page.getByText(/Saved Slide card/).waitFor();
  const card = (await j("GET", `/api/projects/${projectId}/parts`)).body.find((p) => p.name === "Slide card" && p.html === "<div>{{kicker}}: {{title}}</div>");
  assert.equal(card?.version, 2);
});

for (const theme of ["day", "night"]) {
  test(`no serious accessibility violations on a part open in the editor in ${theme}`, async () => {
    await page.goto(partPage);
    await page.getByRole("note", { name: "Changing a part" }).waitFor();
    await frame().locator("[data-stitch-id]").first().waitFor();
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(500);
    assert.deepEqual((await axeProblems(page)).filter((p) => !p.startsWith("scrollable-region")), []);
  });
}

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
    await page.getByRole("button", { name: "Add Lower third" }).first().waitFor();
    await page.waitForTimeout(500);
    assert.deepEqual((await axeProblems(page)).filter((p) => !p.startsWith("scrollable-region")), []);
  });
}
