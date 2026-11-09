// The claims check (design sheet f47), end to end: the editor's Claims section, the person's
// model (a scripted fake of the Anthropic API) reading the words beside the Brief, and Use
// this wording putting the true way to say it on the pattern, as one change to undo.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test, { after, before } from "node:test";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, page, projectId, patternId, fake;
const sent = [];
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const CLAIM = "Works with Apple Music and Spotify";
const FIX = "Works with Apple Music. Spotify, by invitation";
const headline = async () => (await j("GET", `/api/patterns/${patternId}`)).body.stitches.find((s) => s.slot === "headline");
const section = () => page.locator("details").filter({ has: page.locator("summary", { hasText: /^Claims$/ }) });

before(async () => {
  // The model's answer: the headline is against the Brief, with a true way to say it, and
  // "Apple Music" on its own is backed.
  fake = createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    sent.push(JSON.parse(b));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ model: "claude-sonnet-5-5", stop_reason: "end_turn", usage: { input_tokens: 800, output_tokens: 200 }, content: [{ type: "text", text: JSON.stringify({ claims: [
      { quote: CLAIM, verdict: "against", brief: "Spotify is in early access, by invitation.", why: "Spotify is by invitation only.", fix: FIX },
      { quote: "Works with Apple Music", verdict: "backed", brief: "Notch works with Apple Music.", why: "", fix: null },
    ] }) }] }));
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  studio = await startStudio({ env: { ANTHROPIC_API_KEY: "sk-test-not-real", KNITTED_ANTHROPIC_URL: `http://127.0.0.1:${fake.address().port}` } });
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Claims e2e", starter: "social" })).body.id;
  patternId = (await j("GET", `/api/projects/${projectId}/patterns`)).body[0].id;
  const h = await headline();
  await j("POST", `/api/patterns/${patternId}/commands`, { command: { type: "updateStitch", id: h.id, patch: { content: CLAIM } }, actor: "human" });
});
after(async () => { await browser?.close(); await studio?.stop(); fake?.closeAllConnections(); fake?.close(); });

test("with an empty Brief there is nothing to check against, and the section says where to write it", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`);
  await page.getByRole("application", { name: "Pattern canvas" }).waitFor();
  const note = section().getByRole("note", { name: "The Brief is empty" });
  await note.waitFor();
  assert.equal(await note.getByRole("link", { name: "Open the Brief" }).getAttribute("href"), `/projects/${projectId}/brief`);
  // Written in another tab: the section keeps up.
  await j("PUT", `/api/projects/${projectId}/brief`, { profile: "# What they offer\nNotch works with Apple Music.\n\n# Available now, and what is not yet\nSpotify is in early access, by invitation." });
  await section().getByRole("button", { name: "Check the claims" }).waitFor();
  assert.equal(sent.length, 0, "nothing is asked of the model until the person checks");
});

test("checking lists what the Brief does not back, with what it says and a true way to say it", async () => {
  await section().getByRole("button", { name: "Check the claims" }).click();
  const list = section().getByRole("list", { name: "Claims to look at" });
  const card = list.getByRole("listitem").first();
  await card.waitFor();
  assert.equal(await list.getByRole("listitem").count(), 1);
  assert.match(await card.innerText(), new RegExp(`Against the Brief[\\s\\S]*${CLAIM}[\\s\\S]*THE BRIEF[\\s\\S]*Spotify is in early access, by invitation[\\s\\S]*SAY INSTEAD[\\s\\S]*${FIX}`, "i"));
  assert.match(await section().getByRole("status").first().innerText(), /1 to fix · 1 backed by the Brief/);
  await section().getByText("1 claim backed by the Brief").waitFor();
  // What went to the model: the Brief, and the words as they are.
  const asked = sent.at(-1);
  assert.match(asked.messages[0].content, /Spotify is in early access, by invitation/);
  assert.match(asked.messages[0].content, new RegExp(`\\[headline\\] "${CLAIM}"`));
  assert.deepEqual(await axeProblems(page), []);
});

test("Use this wording puts it in the quote's place as one change, and undoing it makes the check out of date", async () => {
  await section().getByRole("button", { name: `Use this wording in place of “${CLAIM}”` }).click();
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.find((s) => s.slot === "headline").content === FIX);
  await section().getByText("Changed to the Brief's wording").waitFor();
  assert.match(await section().getByRole("status").first().innerText(), /Nothing left to fix · 1 backed by the Brief/);
  assert.equal(await section().getByText("The words changed since this check.").count(), 0, "its own change does not put it out of date");
  await page.getByRole("button", { name: "Undo" }).click();
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.find((s) => s.slot === "headline").content === CLAIM);
  await section().getByText("The words changed since this check.").waitFor();
  assert.equal(await section().getByRole("button", { name: /^Use this wording/ }).count(), 0, "an out-of-date fix is not offered");
  assert.equal(await section().getByText("Changed to the Brief's wording").count(), 0, "undone, it is not changed any more");
  await section().getByText("Against the Brief").waitFor();
  // Show it picks the text the claim is in.
  await section().getByText("1 claim backed by the Brief").click();
  await section().getByRole("button", { name: "Show it on the canvas: “Works with Apple Music”" }).click();
  await page.getByRole("complementary", { name: "Inspector" }).getByText("Nothing selected").waitFor({ state: "detached" });
});
