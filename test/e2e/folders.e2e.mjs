// Folders: each section of a project sorted the way its person thinks of it. Made,
// filled, renamed, moved and deleted in the studio, from menus and by dragging, and by a
// model over MCP while the person watches. Deleting a folder never deletes what is in it.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, page, projectId, mcpPath;
const files = mkdtempSync(join(tmpdir(), "knitted-folders-e2e-"));
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
/** A model talking to the studio's own MCP address, as Claude Code does. */
async function mcp(method, params) {
  mcpPath ??= (await j("GET", "/api/agent/mcp")).body.path;
  const res = await fetch(studio.url + mcpPath, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await res.json()).result;
}
const call = async (name, args) => JSON.parse((await mcp("tools/call", { name, arguments: args })).content[0].text);
const yarn = async (name) => (await j("GET", `/api/projects/${projectId}/yarn`)).body.find((y) => y.name === name);
const folders = async (section) => (await j("GET", `/api/projects/${projectId}/folders?section=${section}`)).body.folders;
// The project's one trail: Projects, the project, then Yarn and the folders down to this one.
const trail = () => page.getByRole("navigation", { name: "Breadcrumbs" });
/** Serious accessibility problems once whatever is opening has finished its animation. */
async function problems() {
  await page.locator(".dialog, .menu").evaluateAll((els) => Promise.all(els.flatMap((e) => e.getAnimations()).map((a) => a.finished)));
  return axeProblems(page);
}

before(async () => {
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Folders e2e", starter: "social" })).body.id;
  const png = (background) => sharp({ create: { width: 400, height: 300, channels: 3, background } }).png().toBuffer();
  writeFileSync(join(files, "beat.png"), await png({ r: 200, g: 40, b: 40 }));
  writeFileSync(join(files, "cover.png"), await png({ r: 40, g: 40, b: 200 }));
  await mcp("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.0" } });
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("a folder can hold folders of its own, made in one go with a /", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/yarn`);
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByLabel("Name").fill("Royalty free music/Lo-fi");
  await dialog.getByRole("button", { name: "Make folder" }).click();
  await page.getByRole("link", { name: "Royalty free music, folder, 1 folder" }).click();
  await trail().getByText("Royalty free music").waitFor();
  assert.match(page.url(), /folder=Royalty/, "where the person is, is in the address, so Back goes up");
  await page.getByRole("link", { name: "Lo-fi, folder, Empty" }).waitFor();
  assert.deepEqual(await folders("yarn"), ["Royalty free music", "Royalty free music/Lo-fi"]);
  assert.deepEqual(await folders("patterns"), [], "each section has folders of its own");
  assert.deepEqual(await problems(), []);
});

test("a file added in a folder goes into it, and the trail leads back up", async () => {
  await page.getByRole("link", { name: "Lo-fi, folder, Empty" }).click();
  await page.getByText("Nothing in Lo-fi yet").waitFor();
  await page.getByLabel("Choose files to upload").setInputFiles(join(files, "beat.png"));
  await page.getByRole("button", { name: /^beat image/ }).waitFor({ timeout: 20_000 });
  assert.equal((await yarn("beat")).folder, "Royalty free music/Lo-fi");
  await trail().getByRole("link", { name: "Yarn" }).click();
  await page.getByRole("link", { name: "Royalty free music, folder, 1 folder, 1 file" }).waitFor();
});

test("files move from the selection bar, and Undo puts them back where they were", async () => {
  await page.getByLabel("Choose files to upload").setInputFiles(join(files, "cover.png"));
  await page.getByRole("button", { name: /^cover image/ }).waitFor({ timeout: 20_000 });
  await page.getByLabel("Select cover").check();
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Move to folder" }).click();
  const dialog = page.getByRole("dialog", { name: "Move 1 file" });
  await dialog.getByRole("radio", { name: "Lo-fi" }).check();
  assert.deepEqual(await problems(), []);
  await dialog.getByRole("button", { name: "Move here" }).click();
  await page.getByText("Moved it into Lo-fi").waitFor();
  await page.getByRole("button", { name: /^cover image/ }).waitFor({ state: "detached" });
  assert.equal((await yarn("cover")).folder, "Royalty free music/Lo-fi");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: /^cover image/ }).waitFor();
  assert.equal((await yarn("cover")).folder, "");
});

test("a search from a folder looks in the folders inside it, and says where each file is", async () => {
  await page.getByRole("link", { name: /^Royalty free music, folder/ }).click();
  const search = page.getByLabel("Search Royalty free music and the folders in it");
  await search.fill("beat");
  await page.getByText("Looking in Royalty free music and the folders in it.").waitFor();
  await page.getByRole("button", { name: /^beat image .*, in Royalty free music \/ Lo-fi$/ }).waitFor();
  await search.fill("cover");
  await page.getByText("Nothing matches").waitFor();
  await search.fill("");
});

test("a folder is renamed from its menu, and what is in it goes along", async () => {
  await page.getByRole("button", { name: "Actions for the folder Lo-fi" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename folder" });
  await dialog.getByLabel("Name").fill("Lo/fi");
  await dialog.getByRole("button", { name: "Save" }).click();
  await dialog.getByText(/cannot have a \/ in it/).waitFor();
  await dialog.getByLabel("Name").fill("Chill");
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.getByRole("link", { name: "Chill, folder, 1 file" }).waitFor();
  assert.equal((await yarn("beat")).folder, "Royalty free music/Chill");
});

test("a model files things and renames folders, and the open page keeps up", async () => {
  await page.getByRole("link", { name: "Chill, folder, 1 file" }).click();
  await page.getByRole("button", { name: /^beat image/ }).waitFor();
  const cover = await yarn("cover");
  const moved = await call("move_to_folder", { projectId, folder: "royalty free music/chill", yarnIds: [cover.id] });
  assert.deepEqual(moved.moved.yarn, { folder: "Royalty free music/Chill", moved: 1 }, "a folder is found whatever its case");
  await page.getByRole("button", { name: /^cover image/ }).waitFor();
  const listed = await call("list_folders", { projectId, section: "yarn" });
  assert.deepEqual(listed.folders, [{ path: "Royalty free music", items: 0 }, { path: "Royalty free music/Chill", items: 2 }]);
  // Renamed while the person is in it: they are told, and shown the way out.
  await call("rename", { projectId, section: "yarn", folder: "Royalty free music/Chill", name: "Calm" });
  await page.getByText("This folder is not here any more").waitFor();
  await page.getByRole("button", { name: "Go to Royalty free music" }).click();
  await page.getByRole("link", { name: "Calm, folder, 2 files" }).waitFor();
  // The project's activity says what the model sorted.
  await page.goto(`${studio.url}/projects/${projectId}`);
  const activity = page.getByRole("complementary", { name: "Activity" });
  await activity.getByText("filed 1 file into Royalty free music/Chill").waitFor();
  await activity.getByText("renamed the folder Royalty free music/Chill to Royalty free music/Calm in Yarn").waitFor();
});

test("in Patterns, a pattern dragged onto a folder is filed there, and deleting the folder deletes nothing", async () => {
  const story = (await j("GET", `/api/projects/${projectId}/patterns`)).body.find((p) => p.size.name === "Story");
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByLabel("Name").fill("Spring");
  await dialog.getByRole("button", { name: "Make folder" }).click();
  const tile = page.getByRole("link", { name: "Spring, folder, Empty" });
  await page.getByRole("link", { name: `Open ${story.name}` }).dragTo(tile);
  await page.getByText("Moved it into Spring").waitFor();
  await serverHas(studio, `/api/patterns/${story.id}`, (p) => p.folder === "Spring");
  await page.getByRole("link", { name: `Open ${story.name}` }).waitFor({ state: "detached" });
  await page.getByRole("link", { name: "Spring, folder, 1 pattern" }).waitFor();
  assert.equal((await j("GET", `/api/patterns/${story.id}`)).body.version, story.version, "filing a pattern does not change it");
  assert.deepEqual(await problems(), []);

  await page.getByRole("button", { name: "Actions for the folder Spring" }).click();
  await page.getByRole("menuitem", { name: "Delete folder" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete the folder Spring?" });
  await confirm.getByText("The 1 pattern in it moves up to Patterns. Nothing in it is deleted.").waitFor();
  await confirm.getByRole("button", { name: "Delete folder" }).click();
  await page.getByRole("link", { name: `Open ${story.name}` }).waitFor();
  assert.equal((await j("GET", `/api/patterns/${story.id}`)).body.folder, "");
  assert.deepEqual(await folders("patterns"), []);
});

test("a swatch moves into a folder made on the spot, and the swatch list shows what is in the folder", async () => {
  const [swatch] = (await j("GET", `/api/projects/${projectId}/swatches`)).body;
  await page.goto(`${studio.url}/projects/${projectId}/swatch`);
  await page.getByRole("button", { name: swatch.name, pressed: true }).waitFor();
  await page.getByRole("button", { name: "Move to folder" }).click();
  const dialog = page.getByRole("dialog", { name: `Move ${swatch.name}` });
  await dialog.getByLabel("New folder in Swatches").fill("Clients/Acme");
  await dialog.getByRole("button", { name: "Make it" }).click();
  await dialog.getByRole("radio", { name: "Acme" }).waitFor();
  assert.equal(await dialog.getByRole("radio", { name: "Acme" }).isChecked(), true, "the folder just made is the one chosen");
  await dialog.getByRole("button", { name: "Move here" }).click();
  await page.getByText("Moved it into Acme").waitFor();
  await page.getByRole("button", { name: swatch.name, pressed: true }).waitFor({ state: "detached" });
  await page.getByRole("link", { name: "Clients, folder, 1 folder, 1 swatch" }).click();
  await page.getByRole("link", { name: "Acme, folder, 1 swatch" }).click();
  await page.getByRole("button", { name: swatch.name, pressed: true }).waitFor();
  assert.equal((await j("GET", `/api/projects/${projectId}/swatches`)).body[0].folder, "Clients/Acme");
});

test("in Parts, a starter part duplicated in a folder goes into it, and the starters stay as they are", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/parts`);
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByLabel("Name").fill("Lower thirds");
  await dialog.getByRole("button", { name: "Make folder" }).click();
  await page.getByRole("link", { name: "Lower thirds, folder, Empty" }).click();
  await page.getByText("Nothing in Lower thirds yet").waitFor();
  await page.getByRole("region", { name: "Starter parts" }).getByRole("button", { name: "Duplicate" }).first().click();
  await page.getByText(/^Duplicated .* into Lower thirds$/).waitFor();
  const mine = (await j("GET", `/api/projects/${projectId}/parts`)).body.filter((p) => !p.builtin);
  assert.deepEqual(mine.map((p) => p.folder), ["Lower thirds"]);
  await page.getByRole("region", { name: "Your parts" }).getByRole("button", { name: `Move to folder, ${mine[0].name}` }).waitFor();
  assert.deepEqual(await problems(), []);
});

test("the editor's Yarn panel shows the same folders, and each one opens in place", async () => {
  const story = (await j("GET", `/api/projects/${projectId}/patterns`)).body.find((p) => p.size.name === "Story");
  await page.goto(`${studio.url}/projects/${projectId}/patterns/${story.id}`);
  await page.getByRole("application", { name: "Pattern canvas" }).waitFor();
  await page.getByRole("button", { name: "Yarn", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "yarn panel" });
  await panel.getByRole("button", { name: "Royalty free music, folder, 1 folder, 2 files" }).click();
  await panel.getByRole("button", { name: "Calm, folder, 2 files" }).click();
  await panel.getByRole("button", { name: "Use beat" }).waitFor();
  await panel.getByRole("navigation", { name: "Where you are in Yarn" }).getByRole("button", { name: "Yarn" }).click();
  await panel.getByRole("button", { name: "Use beat" }).waitFor({ state: "detached" });
});
