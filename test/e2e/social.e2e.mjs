// Posting, through the studio as a person uses it: set up an X app in Settings, connect it
// (the browser coming back with a code, or the code pasted), post a knit now, schedule one,
// cancel it. X here is a stand-in on this computer (KNITTED_SOCIAL_API), which checks what
// it is sent; nothing reaches a real platform, and secrets go to the test's own folder.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createServer } from "node:http";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, context, page, fake, projectId, knitId;
const tweets = [];
let looks = 0;
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

/** The stand-in for X: every address is /<host>/<path>, as KNITTED_SOCIAL_API sends it. */
function fakeX() {
  let codes = 0;
  return createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const path = new URL(req.url, "http://x").pathname;
    if (path === "/api.x.com/2/oauth2/token") {
      const f = new URLSearchParams(raw);
      if (f.get("grant_type") === "authorization_code" && !f.get("code_verifier")) return send(400, { error: "invalid_request", error_description: "no verifier" });
      codes++;
      return send(200, { access_token: `a${codes}`, refresh_token: `r${codes}`, expires_in: 7200, scope: "tweet.read tweet.write users.read media.write offline.access" });
    }
    if (path === "/api.x.com/2/users/me") return send(200, { data: { id: "42", name: "Knit Studio", username: "knitted" } });
    if (path === "/api.x.com/2/media/upload") return send(200, { data: { id: `m${tweets.length + 1}` } });
    if (path === "/api.x.com/2/tweets" && req.method === "GET") {
      looks++;
      const ids = new URL(req.url, "http://x").searchParams.get("ids").split(",");
      return send(200, { data: ids.map((id) => ({ id, text: "", public_metrics: { impression_count: 1240, like_count: 87, reply_count: 12, retweet_count: 3, quote_count: 0, bookmark_count: 4 } })) });
    }
    if (path === "/api.x.com/2/tweets") { tweets.push(JSON.parse(raw)); return send(201, { data: { id: `t${tweets.length}` } }); }
    // LinkedIn's app for company pages: the sign-in, and the pages the person may post as.
    if (path === "/www.linkedin.com/oauth/v2/accessToken") return send(200, { access_token: "li-pages", expires_in: 5184000, scope: "rw_organization_admin,w_organization_social" });
    if (path === "/api.linkedin.com/rest/organizationAcls") return send(200, { elements: [{ organization: "urn:li:organization:11", role: "ADMINISTRATOR", state: "APPROVED" }] });
    if (path === "/api.linkedin.com/rest/organizations/11") return send(200, { id: 11, localizedName: "FileFreak.io" });
    send(404, { title: "Not here", detail: path });
  });
}

before(async () => {
  fake = fakeX();
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  studio = await startStudio({ env: { KNITTED_SOCIAL_API: `http://127.0.0.1:${fake.address().port}` } });
  browser = await launchBrowser();
  context = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  // The platform's own sign-in page is never opened: the test plays the platform's part.
  await context.route(/^https:\/\/(x\.com|www\.linkedin\.com|www\.instagram\.com|www\.facebook\.com)\//, (r) => r.fulfill({ body: "the platform's sign-in page", contentType: "text/plain" }));
  page = await context.newPage();
  projectId = (await j("POST", "/api/projects", { name: "Social e2e", starter: "social" })).body.id;
  const patternId = (await j("GET", `/api/projects/${projectId}/patterns`)).body[0].id;
  const job = (await j("POST", `/api/patterns/${patternId}/knit`, { params: { format: "png" } })).body;
  let jj;
  for (let i = 0; i < 240; i++) { jj = (await j("GET", `/api/jobs/${job.id}`)).body; if (["done", "failed", "cancelled"].includes(jj.status)) break; await new Promise((r) => setTimeout(r, 500)); }
  assert.equal(jj.status, "done", JSON.stringify(jj.error));
  knitId = (await j("GET", `/api/projects/${projectId}/knits`)).body[0].id;
});
after(async () => { await browser?.close(); await studio?.stop(); fake?.close(); });

/** Press Connect, and play the platform: the sign-in page it opens, and where it sends the browser back. */
async function connectX() {
  const popup = page.waitForEvent("popup");
  await page.getByRole("region", { name: "X" }).getByRole("button", { name: /^Connect (X|another X account)$|^Connect again$/ }).first().click();
  const p = await popup;
  const url = new URL(p.url());
  await p.close();
  return url;
}

test("Posts with no account says where a post can go, and each network leads to its own setup", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/posts`);
  await page.getByRole("heading", { name: "Connect an account to post from here" }).waitFor();
  await page.getByRole("link", { name: "Set up Social" }).waitFor();
  const x = page.getByRole("group", { name: "Posts go to" }).getByRole("link", { name: /^X\b/ });
  assert.match(await x.textContent(), /Set up/);
  await x.click();
  await page.waitForURL(/tab=social&network=x/);
  assert.equal(await page.getByRole("region", { name: "X" }).getByRole("button", { name: /^X\b/ }).getAttribute("aria-expanded"), "true", "X is open");
  assert.equal(await page.getByRole("region", { name: "LinkedIn" }).getByRole("button", { name: /^LinkedIn\b/ }).getAttribute("aria-expanded"), "false", "one at a time");
  await page.goto(`${studio.url}/insights?project=${projectId}`);
  await page.getByRole("list", { name: "What will be here" }).waitFor();
  await page.getByRole("link", { name: "Go to Posts in Social e2e" }).click();
  await page.waitForURL(new RegExp(`/projects/${projectId}/posts$`));
});

test("Settings, Social: an X app is set up from what the card says, and its secret never comes back", async () => {
  await page.goto(`${studio.url}/settings?tab=social&network=x`);
  const card = page.getByRole("region", { name: "X" });
  await card.getByText("Not set up").waitFor();
  await card.getByText("https://knitted.filefreak.page/oauth/").waitFor();
  await card.getByLabel("Client ID").fill("test-client");
  await card.getByLabel("Client ID").blur();
  await card.getByText("Ready to connect").waitFor();
  const cfg = (await j("GET", "/api/social/config")).body;
  assert.equal(cfg.apps.x.clientId, "test-client");
  await card.getByLabel(/Client secret/).fill("very-secret-value");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await serverHas(studio, "/api/social/config", (c) => c.apps.x.secret === true);
  assert.doesNotMatch(JSON.stringify((await j("GET", "/api/social/config")).body), /very-secret-value/);
});

test("connecting: the browser comes back with the code and the account is there; a made-up sign-in is refused", async () => {
  await page.goto(`${studio.url}/settings?tab=social&network=x`);
  const url = await connectX();
  assert.equal(url.host, "x.com");
  assert.equal(url.searchParams.get("redirect_uri"), "https://knitted.filefreak.page/oauth/");
  const state = url.searchParams.get("state");
  assert.equal(state.split(".")[1], new URL(studio.url).port, "the site page finds this computer by the port in the state");
  // What the site's page does: hand the code on to this computer.
  const back = await context.newPage();
  await back.goto(`${studio.url}/api/social/callback?code=from-x&state=${encodeURIComponent(state)}`);
  await back.getByRole("heading", { name: "X is connected" }).waitFor();
  await back.getByText(/knitted can post to @knitted now/).waitFor();
  const again = await fetch(`${studio.url}/api/social/callback?code=from-x&state=${encodeURIComponent(state)}`);
  assert.equal(again.status, 400, "a sign-in comes back once");
  assert.match(await again.text(), /was not waiting for this sign-in/);
  await back.close();
  await page.getByRole("region", { name: "X" }).getByText("@knitted").waitFor();
});

test("connecting by pasting the code the site's page shows", async () => {
  await page.goto(`${studio.url}/settings?tab=social&network=x`);
  const state = (await connectX()).searchParams.get("state");
  const card = page.getByRole("region", { name: "X" });
  await card.getByLabel("Code from X's sign-in").fill(`https://knitted.filefreak.page/oauth/?code=pasted&state=${state}`);
  await card.getByRole("button", { name: "Finish" }).click();
  await page.getByText("X is connected as @knitted.").waitFor();
  assert.equal((await j("GET", "/api/social/accounts")).body.length, 1, "the same account signed in again is one account");
});

test("a knit is posted now from its dialog, and Posts links to it on X", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/knits`);
  await page.getByRole("button", { name: /^Open / }).first().click();
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "X, @knitted" }).check();
  await dialog.getByLabel("Caption", { exact: true }).fill("a".repeat(290));
  await dialog.getByRole("list", { name: "What to fix first" }).getByText(/290 long; X takes 280/).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Post now" }).isDisabled(), true);
  await dialog.getByLabel("Caption", { exact: true }).fill("Made with knitted #knit");
  await dialog.getByText("X 23 of 280").waitFor();
  await dialog.getByRole("button", { name: "Post now" }).click();
  await page.getByText("Posting now. See it in Posts.").waitFor();
  await page.goto(`${studio.url}/projects/${projectId}/posts`);
  const link = page.getByRole("region", { name: "Posted" }).getByRole("link", { name: "Open on X" });
  await link.waitFor({ timeout: 30000 });
  assert.equal(await link.getAttribute("href"), "https://x.com/knitted/status/t1");
  assert.deepEqual(tweets[0], { text: "Made with knitted #knit", media: { media_ids: ["m1"] } });
});

test("a post scheduled for tomorrow waits in Posts, and is cancelled from there", async () => {
  const at = new Date(Date.now() + 86400_000).toISOString();
  const made = (await j("POST", `/api/projects/${projectId}/posts`, { accountIds: [(await j("GET", "/api/social/accounts")).body[0].id], knitIds: [knitId], caption: "Tomorrow", at })).body;
  assert.equal(made[0].status, "scheduled");
  await page.goto(`${studio.url}/projects/${projectId}/posts`);
  const row = page.getByRole("region", { name: "Scheduled" }).getByRole("listitem");
  await row.getByText(/Goes out/).waitFor();
  await row.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("region", { name: "Cancelled" }).getByText("Tomorrow").waitFor();
  assert.equal(tweets.length, 1, "nothing more went to X");
});

test("a draft waits in Posts until the person schedules it", async () => {
  const accountId = (await j("GET", "/api/social/accounts")).body[0].id;
  const res = await j("POST", `/api/projects/${projectId}/posts`, { accountIds: [accountId], knitIds: [knitId], caption: "Draft for later", draft: true });
  assert.equal(res.body[0].status, "draft");
  await page.goto(`${studio.url}/projects/${projectId}/posts`);
  await page.getByRole("region", { name: "Drafts" }).getByText("Draft for later").waitFor();
  await page.getByRole("region", { name: "Drafts" }).getByRole("button", { name: "Schedule" }).click();
  await page.getByRole("dialog").getByLabel("Post at").waitFor();
  await page.keyboard.press("Escape");
});

test("a post's numbers: X is asked only once the person turns X numbers on; then Posts and Insights show them", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/posts`);
  const row = page.getByRole("region", { name: "Posted" }).getByRole("listitem").first();
  await row.getByRole("button", { name: "Check now how this X post is doing" }).click();
  await row.getByText(/X charges your developer account for each look/).waitFor();
  assert.equal(looks, 0, "nothing asked of X, which would cost the person");
  await page.goto(`${studio.url}/settings?tab=social`);
  await page.getByRole("switch", { name: "Ask X for numbers too" }).click();
  await serverHas(studio, "/api/social/config", (c) => c.metricsX === true);
  await page.goto(`${studio.url}/projects/${projectId}/posts`);
  await row.getByRole("button", { name: "Check now how this X post is doing" }).click();
  await row.getByText("1,240 views · 87 likes · 12 comments · 3 reposts · 0 quotes · 4 saves · 8.5% engaged").waitFor();
  assert.equal(looks, 1);
  await page.getByRole("link", { name: "What works, in Insights" }).click();
  await page.getByRole("heading", { name: "What works" }).waitFor();
  assert.match(page.url(), /\/insights\?project=/);
  const x = page.getByRole("region", { name: "By platform" }).getByRole("listitem").filter({ hasText: "X" });
  await x.getByText("1,240 views", { exact: true }).waitFor();
  const posts = page.getByRole("region", { name: "Every post" });
  await posts.getByRole("row", { name: /Made with knitted #knit/ }).getByText("8.5%").waitFor();
  await posts.getByText(/Too new to compare/).first().waitFor();
  // From the side bar too, for every project.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Insights" }).click();
  await page.waitForURL(/\/insights$/);
});

for (const theme of ["day", "night"]) {
  test(`no serious accessibility problems on Insights in ${theme}`, async () => {
    await page.goto(`${studio.url}/insights`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("region", { name: "Every post" }).waitFor();
    await page.waitForTimeout(300);
    assert.deepEqual(await axeProblems(page), []);
  });
}

for (const theme of ["day", "night"]) {
  test(`no serious accessibility problems on Settings, Social, the Post dialog and Posts in ${theme}`, async () => {
    await page.goto(`${studio.url}/settings?tab=social`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("region", { name: "Media host" }).waitFor();
    await page.waitForTimeout(300);
    assert.deepEqual(await axeProblems(page), []);
    await page.goto(`${studio.url}/projects/${projectId}/posts`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("region", { name: "Posted" }).waitFor();
    await page.waitForTimeout(300);
    assert.deepEqual(await axeProblems(page), []);
    await page.goto(`${studio.url}/projects/${projectId}/knits`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("button", { name: /^Open / }).first().click();
    await page.getByRole("button", { name: "Post", exact: true }).click();
    await page.getByRole("dialog").getByRole("checkbox", { name: "X, @knitted" }).waitFor();
    await page.waitForTimeout(300);
    assert.deepEqual(await axeProblems(page), []);
  });
}

test("Settings, Social: Instagram with a Configuration ID signs in through Meta's Unified login, on Facebook", async () => {
  await page.goto(`${studio.url}/settings?tab=social&network=instagram`);
  const card = page.getByRole("region", { name: "Instagram" });
  await card.getByText("Not set up").waitFor();
  // The Meta app's own App ID and secret, as Meta's apps have them now.
  await card.getByLabel("App ID", { exact: true }).fill("1157590070094212");
  await card.getByLabel("App ID", { exact: true }).blur();
  await card.getByLabel(/App secret/).fill("meta-app-secret");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await card.getByText("Ready to connect").waitFor();
  // A configuration's ID is a number.
  const config = card.getByLabel("Configuration ID");
  await config.fill("my config");
  await config.blur();
  await page.getByText(/A Configuration ID is a number/).first().waitFor();
  await config.fill("998877");
  await config.blur();
  for (let i = 0; i < 40 && (await j("GET", "/api/social/config")).body.apps.instagram.configId !== "998877"; i++) await new Promise((r) => setTimeout(r, 100));
  const cfg = (await j("GET", "/api/social/config")).body.apps.instagram;
  assert.equal(cfg.configId, "998877");
  assert.equal(cfg.secret, true);
  assert.equal(JSON.stringify(cfg).includes("meta-app-secret"), false, "the secret never comes back");
  // Connect opens Facebook's sign-in with the configuration, and no list of permissions.
  const popup = page.waitForEvent("popup");
  await card.getByRole("button", { name: "Connect Instagram" }).click();
  const p = await popup;
  const url = new URL(p.url());
  await p.close();
  assert.equal(`${url.origin}${url.pathname}`, "https://www.facebook.com/dialog/oauth");
  assert.equal(url.searchParams.get("client_id"), "1157590070094212");
  assert.equal(url.searchParams.get("config_id"), "998877");
  assert.equal(url.searchParams.get("redirect_uri"), "https://knitted.filefreak.page/oauth/");
  assert.equal(url.searchParams.get("scope"), null);
  assert.deepEqual(await axeProblems(page), []);
});

test("Settings, Social: LinkedIn asks who posts; a company page's own app connects each page the person looks after, and a post to a page has no connections to pick", async () => {
  await page.goto(`${studio.url}/settings?tab=social&network=linkedin`);
  const card = page.getByRole("region", { name: "LinkedIn" });
  await card.getByText("Make a LinkedIn app").waitFor();
  assert.equal(await card.getByRole("radio", { name: "You", exact: true }).getAttribute("aria-checked"), "true", "as the person, to begin with");
  await card.getByRole("radio", { name: "Your company page" }).click();
  await card.getByText("Have LinkedIn approve an app for your page").waitFor();
  await card.getByText(/request the Community Management API/).waitFor();
  await card.getByLabel("Client ID").fill("pages-client");
  await card.getByLabel("Client ID").blur();
  await card.getByLabel(/Client secret/).fill("pages-secret");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  const cfg = (await serverHas(studio, "/api/social/config", (c) => c.apps.linkedin.pages?.secret === true)).apps.linkedin;
  assert.equal(cfg.pages.clientId, "pages-client");
  assert.equal(cfg.clientId, "", "the app for the person is its own");
  assert.equal(JSON.stringify(cfg).includes("pages-secret"), false, "the secret never comes back");

  const popup = page.waitForEvent("popup");
  await card.getByRole("button", { name: "Connect your pages" }).click();
  const p = await popup;
  const url = new URL(p.url());
  await p.close();
  assert.equal(url.host, "www.linkedin.com");
  assert.equal(url.searchParams.get("client_id"), "pages-client");
  assert.equal(url.searchParams.get("scope"), "rw_organization_admin w_organization_social");
  const back = await context.newPage();
  await back.goto(`${studio.url}/api/social/callback?code=from-linkedin&state=${encodeURIComponent(url.searchParams.get("state"))}`);
  await back.getByRole("heading", { name: "LinkedIn is connected" }).waitFor();
  await back.getByText(/knitted can post to FileFreak\.io now/).waitFor();
  await back.close();
  const row = card.locator(".net-account").filter({ hasText: "FileFreak.io" });
  await row.getByText("Company page").waitFor();
  assert.deepEqual(await axeProblems(page), []);
  // The person's own app shows its own accounts, and the page is not one of them.
  await card.getByRole("radio", { name: "You", exact: true }).click();
  await card.getByText("Make a LinkedIn app").waitFor();
  assert.equal(await card.locator(".net-account").filter({ hasText: "FileFreak.io" }).count(), 0);

  // Posting: the page says it is one, and has no "your connections" to choose.
  await page.goto(`${studio.url}/projects/${projectId}/knits`);
  await page.getByRole("button", { name: /^Open / }).first().click();
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const pick = dialog.getByRole("checkbox", { name: "LinkedIn, FileFreak.io, company page" });
  await pick.check();
  await dialog.getByText("FileFreak.io · company page").waitFor();
  assert.equal(await dialog.getByRole("combobox", { name: "Who can see it on LinkedIn" }).count(), 0);
  await page.keyboard.press("Escape");
});
