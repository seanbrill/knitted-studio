// Posting, against stand-ins for each platform: every request knitted makes is checked
// against what the platform's documentation says it takes. Nothing here reaches a platform,
// and secrets go to a store in memory, never the Keychain.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createPost, getAccount, getPost, insertKnit, listAccounts, openStore, getSecret } from "@knitted/core/node";
import { SITE_CALLBACK } from "@knitted/core";
import { cancelScheduled, chunks, finishConnect, littleText, objectUrl, prepareMedia, readPasted, runDue, setSocialConfig, signV4, startConnect, testHost } from "../src/index.mjs";

const memory = () => {
  const m = new Map();
  return { name: "memory", available: async () => true, get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), remove: async (k) => void m.delete(k), m };
};
const lower = (h = {}) => Object.fromEntries(Object.entries(h instanceof Headers ? Object.fromEntries(h) : h).map(([k, v]) => [k.toLowerCase(), v]));
const parse = (b) => {
  if (b instanceof URLSearchParams) return Object.fromEntries(b);
  if (typeof b === "string") { try { return JSON.parse(b); } catch { return b; } }
  return b;
};

/** A stand-in for the platforms: routes by "METHOD host/path", a trailing * for any rest of the path. */
function net(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${(init.method ?? "GET").toUpperCase()} ${u.host}${u.pathname}`;
    const call = { key, url: u, headers: lower(init.headers), body: parse(init.body), raw: init.body };
    calls.push(call);
    const route = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && key.startsWith(k.slice(0, -1)))?.[1];
    if (!route) return Response.json({ error: { message: `nothing at ${key}` } }, { status: 404 });
    const r = await route(call);
    return r instanceof Response ? r : Response.json(r);
  };
  return { fetch, calls, find: (k) => calls.filter((c) => c.key === k || (k.endsWith("*") && c.key.startsWith(k.slice(0, -1)))) };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "knitted-social-"));
  const store = openStore(join(dir, "k.db"));
  const project = store.createProject({ name: "Social" });
  mkdirSync(store.paths.outDir(project.id), { recursive: true });
  const secrets = memory();
  return { store, project, secrets };
}
async function png(store, project, name, w, h) {
  const file = `${name}.png`;
  await sharp({ create: { width: w, height: h, channels: 4, background: "#c0ffee" } }).png().toFile(join(store.paths.outDir(project.id), file));
  return insertKnit(store, { projectId: project.id, patternId: null, patternName: "P", jobId: null, batchId: null, label: name, file, kind: "image", format: "png", width: w, height: h, bytes: 1, durationMs: null, hash: name, report: {} });
}
function mp4(store, project, name, bytes = 100, w = 1080, h = 1920, durationMs = 8000) {
  const file = `${name}.mp4`;
  writeFileSync(join(store.paths.outDir(project.id), file), Buffer.alloc(bytes, 7));
  return insertKnit(store, { projectId: project.id, patternId: null, patternName: "P", jobId: null, batchId: null, label: name, file, kind: "video", format: "mp4", width: w, height: h, bytes, durationMs, hash: name, report: {} });
}
const deps = (n, secrets, more = {}) => ({ fetch: n.fetch, secrets, wait: async () => {}, ...more });

async function connect(store, secrets, platform, routes, { port = 4321, code = "code-1" } = {}) {
  const n = net(routes);
  const { url, state } = await startConnect(store, platform, { port }, { secrets });
  const account = await finishConnect(store, { code, state }, deps(n, secrets));
  return { url: new URL(url), state, account, n };
}

// ── the rules ───────────────────────────────────────────────────────────────

test("SigV4 signs as AWS's own examples do, for a GET with a range and a PUT with a body", () => {
  const keys = { keyId: "AKIAIOSFODNN7EXAMPLE", secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", now: new Date("2013-05-24T00:00:00Z") };
  const get = signV4({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", headers: { Range: "bytes=0-9" }, payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", ...keys });
  assert.match(get.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
  const put = signV4({ method: "PUT", url: "https://examplebucket.s3.amazonaws.com/test$file.text", headers: { Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" }, payloadHash: "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072", ...keys });
  assert.match(put.authorization, /Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
});

test("a bucket's address: Amazon's by name in the host, every other store's in the path", () => {
  assert.equal(objectUrl({ endpoint: "", bucket: "b", region: "eu-west-1" }, "knitted/a b.jpg"), "https://b.s3.eu-west-1.amazonaws.com/knitted/a%20b.jpg");
  assert.equal(objectUrl({ endpoint: "https://acct.r2.cloudflarestorage.com/", bucket: "b", region: "auto" }, "knitted/a.jpg"), "https://acct.r2.cloudflarestorage.com/b/knitted/a.jpg");
});

test("LinkedIn's little text: its special characters escaped, and a #word made a real hashtag", () => {
  assert.equal(littleText("Ship it (today) @ 9 #launch_day * done"), "Ship it \\(today\\) \\@ 9 {hashtag|\\#|launch_day} \\* done");
});

test("TikTok's parts: a small file whole, a big one in 10 MB parts with the rest in the last", () => {
  assert.deepEqual(chunks(4_000_000), { chunkSize: 4_000_000, count: 1 });
  assert.deepEqual(chunks(25 * 1024 * 1024), { chunkSize: 10 * 1024 * 1024, count: 2 });
});

test("a pasted code reads back from the site page's link or its query", () => {
  assert.deepEqual(readPasted("https://knitted.filefreak.page/oauth/?code=abc&state=n.1"), { code: "abc", state: "n.1", error: null, errorDescription: null });
  assert.equal(readPasted("?code=abc&state=n.1").code, "abc");
});

test("pictures become JPEGs no wider than 1440 for Instagram, and stay PNG for X", async () => {
  const { store, project } = setup();
  const k = await png(store, project, "wide", 2000, 2000);
  const ig = await prepareMedia(store, "instagram", [k], "sp_1");
  assert.equal(ig.media[0].mime, "image/jpeg");
  assert.equal(ig.media[0].width, 1440);
  await ig.cleanup();
  const xm = await prepareMedia(store, "x", [k], "sp_2");
  assert.equal(xm.media[0].mime, "image/png");
});

// ── connecting ──────────────────────────────────────────────────────────────

test("connecting refuses a sign-in knitted did not start, and says so when the person said no", async () => {
  const { store, secrets } = setup();
  await setSocialConfig(store, { apps: { x: { clientId: "cid" } } }, { secrets });
  await assert.rejects(finishConnect(store, { code: "c", state: "made-up.4321" }, { secrets }), /was not waiting for this sign-in/);
  const { state } = await startConnect(store, "x", { port: 4321 }, { secrets });
  await assert.rejects(finishConnect(store, { error: "access_denied", state }, { secrets }), /did not allow knitted on X/);
  await assert.rejects(finishConnect(store, { code: "c", state }, { secrets }), /was not waiting/, "a state works once");
});

test("an app with no client id says what to set up", async () => {
  const { store, secrets } = setup();
  await assert.rejects(startConnect(store, "linkedin", { port: 1 }, { secrets }), /Set up your LinkedIn app first: its client id and secret/);
});

// ── X ──────────────────────────────────────────────────────────────────────

test("X: connect with PKCE, post a picture, renew the two-hour sign-in with its one-time refresh token", async () => {
  const { store, project, secrets } = setup();
  await setSocialConfig(store, { apps: { x: { clientId: "cid" } } }, { secrets });
  let refreshed = 0;
  const routes = {
    "POST api.x.com/2/oauth2/token": ({ body, headers }) => {
      assert.equal(body.client_id, "cid"); assert.equal(headers.authorization, undefined, "a native app sends no secret");
      if (body.grant_type === "authorization_code") { assert.ok(body.code_verifier?.length >= 43); return { access_token: "a1", refresh_token: "r1", expires_in: 7200, scope: "tweet.read tweet.write" }; }
      assert.equal(body.refresh_token, refreshed ? "r2" : "r1"); refreshed++;
      return { access_token: `a${refreshed + 1}`, refresh_token: `r${refreshed + 1}`, expires_in: 7200 };
    },
    "GET api.x.com/2/users/me": ({ headers }) => { assert.equal(headers.authorization, "Bearer a1"); return { data: { id: "42", name: "Knit", username: "knitted" } }; },
  };
  const { url, state, account } = await connect(store, secrets, "x", routes);
  assert.equal(url.host, "x.com");
  assert.equal(url.searchParams.get("redirect_uri"), SITE_CALLBACK);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(state, /\.4321$/, "the site page reads the port from the state");
  assert.equal(account.handle, "knitted");
  assert.equal(JSON.parse(await getSecret(`social_token_${account.id}`, store.paths.root, secrets)).refresh, "r1");

  const k = await png(store, project, "post", 1080, 1080);
  const post = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [k.id], caption: "Hello #knit" });
  // The sign-in is about to run out: it is renewed before posting, and the new refresh token kept.
  const t = JSON.parse(secrets.m.get(`social_token_${account.id}`)); t.expiresAt = Date.now() + 1000; secrets.m.set(`social_token_${account.id}`, JSON.stringify(t));
  const n = net({
    ...routes,
    "POST api.x.com/2/media/upload": ({ headers, raw }) => { assert.equal(headers.authorization, "Bearer a2"); assert.ok(raw instanceof FormData); assert.equal(raw.get("media_category"), "tweet_image"); return { data: { id: "m1" } }; },
    "POST api.x.com/2/tweets": ({ body }) => { assert.deepEqual(body, { text: "Hello #knit", media: { media_ids: ["m1"] } }); return { data: { id: "t1" } }; },
  });
  await runDue(store, deps(n, secrets));
  const done = getPost(store, post.id);
  assert.equal(done.status, "posted", done.error);
  assert.equal(done.url, "https://x.com/knitted/status/t1");
  assert.equal(JSON.parse(secrets.m.get(`social_token_${account.id}`)).refresh, "r2", "X's refresh tokens work once: the new one is kept");
});

test("X: a network failure before posting is tried again; a failure while posting is not, and says to look first", async () => {
  const { store, project, secrets } = setup();
  await setSocialConfig(store, { apps: { x: { clientId: "cid" } } }, { secrets });
  const { account } = await connect(store, secrets, "x", {
    "POST api.x.com/2/oauth2/token": () => ({ access_token: "a1", refresh_token: "r1", expires_in: 7200 }),
    "GET api.x.com/2/users/me": () => ({ data: { id: "42", username: "knitted" } }),
  });
  const k = await png(store, project, "p", 1080, 1080);
  const a = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [k.id], caption: "One" });
  await runDue(store, deps({ fetch: async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); } }, secrets));
  const later = getPost(store, a.id);
  assert.equal(later.status, "scheduled");
  assert.match(later.error, /Could not reach X: ENOTFOUND\. .*tries again at/);
  assert.ok(Date.parse(later.scheduledAt) > Date.now() + 60_000);

  const b = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [k.id], caption: "Two" });
  await runDue(store, deps(net({ "POST api.x.com/2/media/upload": () => ({ data: { id: "m1" } }), "POST api.x.com/2/tweets": () => new Response("busy", { status: 503 }) }), secrets));
  const lost = getPost(store, b.id);
  assert.equal(lost.status, "failed");
  assert.match(lost.error, /may have gone out anyway: look on X before you post it again/);
});

test("X: a sign-in X stopped taking marks the account to connect again", async () => {
  const { store, project, secrets } = setup();
  await setSocialConfig(store, { apps: { x: { clientId: "cid" } } }, { secrets });
  const { account } = await connect(store, secrets, "x", { "POST api.x.com/2/oauth2/token": () => ({ access_token: "a1", refresh_token: "r1", expires_in: 7200 }), "GET api.x.com/2/users/me": () => ({ data: { id: "42", username: "k" } }) });
  const k = await png(store, project, "p", 1080, 1080);
  const p = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [k.id], caption: "x" });
  await runDue(store, deps(net({ "POST api.x.com/2/media/upload": () => Response.json({ title: "Unauthorized" }, { status: 401 }) }), secrets));
  assert.equal(getPost(store, p.id).status, "failed");
  assert.equal(getAccount(store, account.id).status, "reconnect");
  assert.match(getAccount(store, account.id).note, /Connect X again/);
});

test("a post due while knitted was closed for over two hours waits as missed, not sent late", async () => {
  const { store, project, secrets } = setup();
  await setSocialConfig(store, { apps: { x: { clientId: "cid" } } }, { secrets });
  const { account } = await connect(store, secrets, "x", { "POST api.x.com/2/oauth2/token": () => ({ access_token: "a1", expires_in: 7200 }), "GET api.x.com/2/users/me": () => ({ data: { id: "42", username: "k" } }) });
  const k = await png(store, project, "p", 1080, 1080);
  const p = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [k.id], caption: "x" });
  store.db.prepare("update social_posts set scheduled_at = ? where id = ?").run(new Date(Date.now() - 3 * 3600_000).toISOString(), p.id);
  const n = net({});
  await runDue(store, deps(n, secrets));
  assert.equal(getPost(store, p.id).status, "missed");
  assert.match(getPost(store, p.id).error, /while knitted was closed\. Post it now, or pick another time/);
  assert.equal(n.calls.length, 0);
});

// ── LinkedIn ────────────────────────────────────────────────────────────────

test("LinkedIn: connect with the secret in the body, post a picture as the person, and know the 60 days end", async () => {
  const { store, project, secrets } = setup();
  await setSocialConfig(store, { apps: { linkedin: { clientId: "lid", clientSecret: "lsecret" } } }, { secrets });
  const { url, account } = await connect(store, secrets, "linkedin", {
    "POST www.linkedin.com/oauth/v2/accessToken": ({ body }) => { assert.equal(body.client_secret, "lsecret"); assert.equal(body.redirect_uri, SITE_CALLBACK); return { access_token: "la", expires_in: 5184000, scope: "openid,profile,w_member_social" }; },
    "GET api.linkedin.com/v2/userinfo": () => ({ sub: "abc", name: "Sam Knit" }),
  });
  assert.equal(url.searchParams.get("scope"), "openid profile w_member_social");
  assert.ok(account.expiresAt && Date.parse(account.expiresAt) > Date.now() + 59 * 86400_000, "no refresh token: the end of the sign-in is shown");
  const k = await png(store, project, "p", 1200, 627);
  const p = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [k.id], caption: "Big news (really) #launch" });
  const n = net({
    "POST api.linkedin.com/rest/images": ({ url: u, headers, body }) => { assert.equal(u.searchParams.get("action"), "initializeUpload"); assert.equal(headers["linkedin-version"], "202610"); assert.equal(body.initializeUploadRequest.owner, "urn:li:person:abc"); return { value: { uploadUrl: "https://www.linkedin.com/dms-uploads/u1", image: "urn:li:image:1" } }; },
    "PUT www.linkedin.com/dms-uploads/u1": ({ headers }) => { assert.equal(headers.authorization, "Bearer la"); return new Response(null, { status: 201 }); },
    "POST api.linkedin.com/rest/posts": ({ body, headers }) => {
      assert.equal(headers["x-restli-protocol-version"], "2.0.0");
      assert.equal(body.author, "urn:li:person:abc");
      assert.equal(body.commentary, "Big news \\(really\\) {hashtag|\\#|launch}");
      assert.deepEqual(body.content, { media: { id: "urn:li:image:1" } });
      return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:9" } });
    },
  });
  await runDue(store, deps(n, secrets));
  const done = getPost(store, p.id);
  assert.equal(done.status, "posted", done.error);
  assert.equal(done.url, "https://www.linkedin.com/feed/update/urn:li:share:9/");
});

// ── Instagram and Threads, through a media host ─────────────────────────────

const S3 = { kind: "s3", s3: { endpoint: "https://s3.example.test", region: "auto", bucket: "b", keyId: "KID", secret: "SEC", publicBase: "https://media.example.test", prefix: "knitted/" } };

test("Instagram: refuses without a media host; with one, the picture goes up as a JPEG, is posted, and is removed", async () => {
  const { store, project, secrets } = setup();
  await setSocialConfig(store, { apps: { instagram: { clientId: "iid", clientSecret: "isec" } } }, { secrets });
  const { account } = await connect(store, secrets, "instagram", {
    "POST api.instagram.com/oauth/access_token": ({ body }) => { assert.equal(body.code, "abc", "the #_ Instagram adds is not part of the code"); return { data: [{ access_token: "short", user_id: 1 }] }; },
    "GET graph.instagram.com/access_token": ({ url: u }) => { assert.equal(u.searchParams.get("grant_type"), "ig_exchange_token"); return { access_token: "long", expires_in: 5184000 }; },
    "GET graph.instagram.com/v27.0/me": () => ({ user_id: "17841400000000001", username: "knit" }),
  }, { code: "abc#_" });
  assert.equal(account.externalId, "17841400000000001", "ids kept as strings");
  const k = await png(store, project, "feed", 1080, 1350);
  const p = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [k.id], caption: "Feed post" });
  await runDue(store, deps(net({}), secrets));
  assert.match(getPost(store, p.id).error, /needs a media host: set one up in Settings, Social/);

  await setSocialConfig(store, { host: S3 }, { secrets });
  const q = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [k.id], caption: "Feed post" });
  let put = null;
  const n = net({
    "PUT s3.example.test/b/*": ({ url: u, headers }) => { put = u.pathname; assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=KID\//); assert.equal(headers["content-type"], "image/jpeg"); return new Response(null, { status: 200 }); },
    "DELETE s3.example.test/b/*": () => new Response(null, { status: 204 }),
    "POST graph.instagram.com/v27.0/17841400000000001/media": ({ body }) => { assert.equal(body.image_url, `https://media.example.test${put.replace("/b", "")}`); assert.equal(body.caption, "Feed post"); assert.equal(body.access_token, "long"); return { id: "c1" }; },
    "GET graph.instagram.com/v27.0/c1": () => ({ status_code: "FINISHED" }),
    "POST graph.instagram.com/v27.0/17841400000000001/media_publish": ({ body }) => { assert.equal(body.creation_id, "c1"); return { id: "p1" }; },
    "GET graph.instagram.com/v27.0/p1": () => ({ permalink: "https://www.instagram.com/p/abc/" }),
  });
  await runDue(store, deps(n, secrets));
  const done = getPost(store, q.id);
  assert.equal(done.status, "posted", done.error);
  assert.equal(done.url, "https://www.instagram.com/p/abc/");
  assert.equal(n.find("DELETE s3.example.test/b/*").length, 1, "the file is taken off the host after");
});

test("Instagram: a tall picture goes to Stories, and a video is a Reel", async () => {
  const { store, project, secrets } = setup();
  await setSocialConfig(store, { apps: { instagram: { clientId: "iid", clientSecret: "isec" } }, host: S3 }, { secrets });
  const { account } = await connect(store, secrets, "instagram", {
    "POST api.instagram.com/oauth/access_token": () => ({ access_token: "short", user_id: 1 }),
    "GET graph.instagram.com/access_token": () => ({ access_token: "long", expires_in: 5184000 }),
    "GET graph.instagram.com/v27.0/me": () => ({ user_id: "9", username: "knit" }),
  });
  const story = await png(store, project, "story", 1080, 1920);
  const reel = mp4(store, project, "reel");
  createPost(store, { projectId: project.id, accountId: account.id, knitIds: [story.id], caption: "s" });
  createPost(store, { projectId: project.id, accountId: account.id, knitIds: [reel.id], caption: "r" });
  const made = [];
  const n = net({
    "PUT s3.example.test/b/*": () => new Response(null, { status: 200 }), "DELETE s3.example.test/b/*": () => new Response(null, { status: 204 }),
    "POST graph.instagram.com/v27.0/9/media": ({ body }) => { made.push(body); return { id: `c${made.length}` }; },
    "GET graph.instagram.com/v27.0/*": () => ({ status_code: "FINISHED", permalink: "https://www.instagram.com/p/x/" }),
    "POST graph.instagram.com/v27.0/9/media_publish": () => ({ id: "p" }),
  });
  await runDue(store, deps(n, secrets));
  assert.equal(made[0].media_type, "STORIES");
  assert.equal(made[1].media_type, "REELS");
  assert.equal(made[1].share_to_feed, "true");
});

test("Instagram, Meta's Unified login: Facebook's sign-in with the configuration, a token that does not run out, every account it was given, and posts on graph.facebook.com", async () => {
  const { store, project, secrets } = setup();
  await setSocialConfig(store, { apps: { instagram: { clientId: "1157590070094212", clientSecret: "msec", configId: "998877" } }, host: S3 }, { secrets });
  const { url, account, n: signIn } = await connect(store, secrets, "instagram", {
    "GET graph.facebook.com/v27.0/oauth/access_token": ({ url: u }) => {
      assert.equal(u.searchParams.get("client_id"), "1157590070094212", "the Meta app's own App ID");
      assert.equal(u.searchParams.get("client_secret"), "msec");
      assert.equal(u.searchParams.get("code"), "abc");
      assert.equal(u.searchParams.get("redirect_uri"), SITE_CALLBACK);
      return { access_token: "suat", token_type: "bearer" };
    },
    "GET graph.facebook.com/v27.0/me/assigned_instagram_accounts": ({ url: u }) => { assert.equal(u.searchParams.get("access_token"), "suat"); return { data: [{ id: "17841400000000002", username: "knit" }, { id: "17841400000000003", username: "knit.shop" }] }; },
    "GET graph.facebook.com/v27.0/17841400000000002": () => ({ name: "Knit", username: "knit", profile_picture_url: "https://cdn.example.test/k.jpg" }),
    "GET graph.facebook.com/v27.0/17841400000000003": () => ({ error: { message: "no picture for you", code: 100 } }),
  }, { code: "abc#_=_" });
  // Facebook's own sign-in, with the configuration and no list of permissions.
  assert.equal(`${url.origin}${url.pathname}`, "https://www.facebook.com/dialog/oauth");
  assert.equal(url.searchParams.get("client_id"), "1157590070094212");
  assert.equal(url.searchParams.get("config_id"), "998877");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), SITE_CALLBACK);
  assert.equal(url.searchParams.get("scope"), null);
  assert.equal(signIn.find("GET graph.instagram.com/*").length, 0, "nothing asked of Instagram's own sign-in");
  // Each account the business gave knitted, with one token between them that does not run out.
  assert.equal(account.externalId, "17841400000000002");
  assert.equal(account.avatar, "https://cdn.example.test/k.jpg");
  assert.equal(account.expiresAt, null);
  const both = listAccounts(store).filter((a) => a.platform === "instagram");
  assert.deepEqual(both.map((a) => a.handle).sort(), ["knit", "knit.shop"]);
  const tokens = JSON.parse(await getSecret(`social_token_${account.id}`, store.paths.root, secrets));
  assert.equal(tokens.via, "unified");
  assert.equal(tokens.expiresAt, null);

  // A post goes to graph.facebook.com, as the same calls Instagram's own sign-in makes.
  const k = await png(store, project, "feed", 1080, 1350);
  const p = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [k.id], caption: "Feed post" });
  const n = net({
    "PUT s3.example.test/b/*": () => new Response(null, { status: 200 }), "DELETE s3.example.test/b/*": () => new Response(null, { status: 204 }),
    "POST graph.facebook.com/v27.0/17841400000000002/media": ({ body }) => { assert.equal(body.caption, "Feed post"); assert.equal(body.access_token, "suat"); return { id: "c1" }; },
    "GET graph.facebook.com/v27.0/c1": () => ({ status_code: "FINISHED" }),
    "POST graph.facebook.com/v27.0/17841400000000002/media_publish": ({ body }) => { assert.equal(body.creation_id, "c1"); return { id: "p1" }; },
    "GET graph.facebook.com/v27.0/p1": () => ({ permalink: "https://www.instagram.com/p/uni/" }),
  });
  await runDue(store, deps(n, secrets));
  const done = getPost(store, p.id);
  assert.equal(done.status, "posted", done.error);
  assert.equal(done.url, "https://www.instagram.com/p/uni/");
  assert.equal(n.find("GET graph.instagram.com/*").length + n.find("POST graph.instagram.com/*").length, 0);
});

test("Instagram, Meta's Unified login: a configuration that gave knitted no account says what to add", async () => {
  const { store, secrets } = setup();
  await setSocialConfig(store, { apps: { instagram: { clientId: "1157590070094212", clientSecret: "msec", configId: "998877" } } }, { secrets });
  await assert.rejects(connect(store, secrets, "instagram", {
    "GET graph.facebook.com/v27.0/oauth/access_token": () => ({ access_token: "suat" }),
    "GET graph.facebook.com/v27.0/me/assigned_instagram_accounts": () => ({ data: [] }),
    "GET graph.facebook.com/v27.0/me/accounts": () => ({ data: [{ id: "page1" }] }),
  }), /no Instagram account.*business_management/s);
});

test("Instagram, Meta's Unified login: a person's token, not the business's, is made long-lived and found through its Page", async () => {
  const { store, secrets } = setup();
  await setSocialConfig(store, { apps: { instagram: { clientId: "1157590070094212", clientSecret: "msec", configId: "998877" } } }, { secrets });
  const { account } = await connect(store, secrets, "instagram", {
    "GET graph.facebook.com/v27.0/oauth/access_token": ({ url: u }) => u.searchParams.get("grant_type") === "fb_exchange_token"
      ? (assert.equal(u.searchParams.get("fb_exchange_token"), "short"), { access_token: "long", expires_in: 5183944 })
      : { access_token: "short", expires_in: 5400 },
    "GET graph.facebook.com/v27.0/me/assigned_instagram_accounts": () => Response.json({ error: { message: "Unsupported get request.", code: 100 } }, { status: 400 }),
    "GET graph.facebook.com/v27.0/me/accounts": ({ url: u }) => { assert.equal(u.searchParams.get("access_token"), "long"); return { data: [{ id: "page1", instagram_business_account: { id: "1784", username: "knit", name: "Knit" } }, { id: "page2" }] }; },
  });
  assert.equal(account.externalId, "1784");
  assert.ok(account.expiresAt, "a person's token runs out, and Settings says when");
});

test("Threads: a carousel is each picture as an item, then one post of them", async () => {
  const { store, project, secrets } = setup();
  await setSocialConfig(store, { apps: { threads: { clientId: "tid", clientSecret: "tsec" } }, host: S3 }, { secrets });
  const { account } = await connect(store, secrets, "threads", {
    "POST graph.threads.com/oauth/access_token": () => ({ access_token: "short", user_id: 5 }),
    "GET graph.threads.com/access_token": ({ url: u }) => { assert.equal(u.searchParams.get("grant_type"), "th_exchange_token"); return { access_token: "long", expires_in: 5184000 }; },
    "GET graph.threads.com/v1.0/me": () => ({ id: "5", username: "knit" }),
  });
  const a = await png(store, project, "a", 1080, 1080), b = await png(store, project, "b", 1080, 1080);
  const p = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [a.id, b.id], caption: "Two" });
  const made = [];
  const n = net({
    "PUT s3.example.test/b/*": () => new Response(null, { status: 200 }), "DELETE s3.example.test/b/*": () => new Response(null, { status: 204 }),
    "POST graph.threads.com/v1.0/5/threads": ({ body }) => { made.push(body); return { id: `c${made.length}` }; },
    "GET graph.threads.com/v1.0/*": () => ({ status: "FINISHED", permalink: "https://www.threads.com/@knit/post/x" }),
    "POST graph.threads.com/v1.0/5/threads_publish": ({ body }) => { assert.equal(body.creation_id, "c3"); return { id: "t1" }; },
  });
  await runDue(store, deps(n, secrets));
  assert.equal(getPost(store, p.id).status, "posted", getPost(store, p.id).error);
  assert.deepEqual(made.map((m) => [m.media_type, m.is_carousel_item]), [["IMAGE", "true"], ["IMAGE", "true"], ["CAROUSEL", undefined]]);
  assert.equal(made[2].children, "c1,c2");
  assert.equal(made[2].text, "Two");
});

// ── TikTok ─────────────────────────────────────────────────────────────────

test("TikTok: connect back to this computer with a hex PKCE challenge; post a video the person chose the privacy of", async () => {
  const { store, project, secrets } = setup();
  await setSocialConfig(store, { apps: { tiktok: { clientId: "ck", clientSecret: "cs" } } }, { secrets });
  const { url, account } = await connect(store, secrets, "tiktok", {
    "POST open.tiktokapis.com/v2/oauth/token/": ({ body }) => { assert.equal(body.client_key, "ck"); assert.equal(body.redirect_uri, "http://127.0.0.1:4321/api/social/callback/"); return { access_token: "ta", refresh_token: "tr", open_id: "oid", expires_in: 86400, refresh_expires_in: 31536000, scope: "user.info.basic,video.publish" }; },
    "POST open.tiktokapis.com/v2/post/publish/creator_info/query/": () => ({ data: { creator_username: "knit", creator_nickname: "Knit", privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } }),
  });
  assert.match(url.searchParams.get("code_challenge"), /^[0-9a-f]{64}$/, "TikTok wants the SHA-256 in hex");
  assert.equal(account.externalId, "oid");
  const v = mp4(store, project, "clip", 100);
  assert.throws(() => createPost(store, { projectId: project.id, accountId: account.id, knitIds: [v.id], caption: "c" }), /Pick who can see it on TikTok/);
  const pic = await png(store, project, "pic", 1080, 1920);
  assert.throws(() => createPost(store, { projectId: project.id, accountId: account.id, knitIds: [pic.id], caption: "c", options: { privacy: "SELF_ONLY" } }), /TikTok takes videos only/);
  const p = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [v.id], caption: "My clip #knit", options: { privacy: "SELF_ONLY" } });
  const n = net({
    "POST open.tiktokapis.com/v2/post/publish/video/init/": ({ body }) => {
      assert.equal(body.post_info.privacy_level, "SELF_ONLY");
      assert.equal(body.post_info.disable_comment, true, "comments are off until the person turns them on");
      assert.deepEqual(body.source_info, { source: "FILE_UPLOAD", video_size: 100, chunk_size: 100, total_chunk_count: 1 });
      return { data: { publish_id: "pub1", upload_url: "https://open-upload.tiktokapis.com/upload/?u=1" }, error: { code: "ok" } };
    },
    "PUT open-upload.tiktokapis.com/upload/": ({ headers }) => { assert.equal(headers["content-range"], "bytes 0-99/100"); return new Response(null, { status: 201 }); },
    "POST open.tiktokapis.com/v2/post/publish/status/fetch/": () => ({ data: { status: "PUBLISH_COMPLETE" }, error: { code: "ok" } }),
  });
  await runDue(store, deps(n, secrets));
  const done = getPost(store, p.id);
  assert.equal(done.status, "posted", done.error);
  assert.match(done.error, /only you can see it/);
  assert.equal(done.url, "https://www.tiktok.com/@knit");
});

test("TikTok: a refusal that comes as a 200 is still a refusal, in words", async () => {
  const { store, project, secrets } = setup();
  await setSocialConfig(store, { apps: { tiktok: { clientId: "ck", clientSecret: "cs" } } }, { secrets });
  const { account } = await connect(store, secrets, "tiktok", {
    "POST open.tiktokapis.com/v2/oauth/token/": () => ({ access_token: "ta", refresh_token: "tr", open_id: "oid", expires_in: 86400 }),
    "POST open.tiktokapis.com/v2/post/publish/creator_info/query/": () => ({ data: { creator_username: "knit" }, error: { code: "ok" } }),
  });
  const p = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [mp4(store, project, "c").id], caption: "c", options: { privacy: "PUBLIC_TO_EVERYONE" } });
  await runDue(store, deps(net({ "POST open.tiktokapis.com/v2/post/publish/video/init/": () => ({ data: {}, error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "x" } }) }), secrets));
  assert.match(getPost(store, p.id).error, /only to a private account\. Make the account private in TikTok/);
});

// ── YouTube ─────────────────────────────────────────────────────────────────

test("YouTube: scheduled ahead, it is uploaded now, private, with its time; YouTube publishes it; cancelling takes it back", async () => {
  const { store, project, secrets } = setup();
  await setSocialConfig(store, { apps: { youtube: { clientId: "gid", clientSecret: "gsec" } } }, { secrets });
  const { url, account } = await connect(store, secrets, "youtube", {
    "POST oauth2.googleapis.com/token": ({ body }) => { assert.equal(body.redirect_uri, "http://127.0.0.1:4321/api/social/callback"); assert.ok(body.code_verifier); return { access_token: "ya", refresh_token: "yr", expires_in: 3599 }; },
    "GET www.googleapis.com/youtube/v3/channels": () => ({ items: [{ id: "UC1", snippet: { title: "Knit", customUrl: "@knit" } }] }),
  });
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(account.handle, "knit");
  const v = mp4(store, project, "short");
  assert.throws(() => createPost(store, { projectId: project.id, accountId: account.id, knitIds: [v.id], caption: "d" }), /YouTube needs a title/);
  const at = new Date(Date.now() + 2 * 3600_000).toISOString();
  const p = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [v.id], caption: "About it", title: "My short", at });
  const n = net({
    "POST www.googleapis.com/upload/youtube/v3/videos": ({ body, headers }) => {
      assert.equal(headers["x-upload-content-length"], "100");
      assert.equal(body.status.privacyStatus, "private"); assert.equal(body.status.publishAt, at); assert.equal(body.status.selfDeclaredMadeForKids, false);
      assert.equal(body.snippet.title, "My short");
      return new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=u1" } });
    },
    "PUT www.googleapis.com/upload/youtube/v3/videos": () => ({ id: "vid1" }),
  });
  await runDue(store, deps(n, secrets));
  const up = getPost(store, p.id);
  assert.equal(up.status, "scheduled", up.error);
  assert.equal(up.options.uploaded, true);
  assert.equal(up.url, "https://www.youtube.com/shorts/vid1");
  await runDue(store, deps(net({}), secrets, { now: () => Date.parse(at) + 60_000 }));
  assert.equal(getPost(store, p.id).status, "posted", "YouTube published it itself");

  const q = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [v.id], caption: "x", title: "Later", at });
  await runDue(store, deps(net({
    "POST www.googleapis.com/upload/youtube/v3/videos": () => new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=u2" } }),
    "PUT www.googleapis.com/upload/youtube/v3/videos": () => ({ id: "vid1" }),
  }), secrets));
  assert.equal(getPost(store, q.id).options.uploaded, true);
  const del = net({ "DELETE www.googleapis.com/youtube/v3/videos": ({ url: u }) => { assert.equal(u.searchParams.get("id"), "vid1"); return new Response(null, { status: 204 }); } });
  await cancelScheduled(store, q.id, deps(del, secrets));
  assert.equal(getPost(store, q.id).status, "cancelled");
  assert.equal(del.calls.length, 1);
});

// ── the media host's test ───────────────────────────────────────────────────

test("testing the media host puts a file, reads it back from its public address, and removes it", async () => {
  const { store, secrets } = setup();
  await setSocialConfig(store, { host: S3 }, { secrets });
  const file = join(store.paths.root, "probe.txt"); writeFileSync(file, "knitted");
  const kept = new Map();
  const n = net({
    "PUT s3.example.test/b/*": ({ url: u, raw }) => { kept.set(u.pathname.replace("/b", ""), Buffer.from(raw)); return new Response(null, { status: 200 }); },
    "GET media.example.test/*": ({ url: u }) => (kept.has(u.pathname) ? new Response(kept.get(u.pathname)) : new Response("no", { status: 403 })),
    "DELETE s3.example.test/b/*": ({ url: u }) => { kept.delete(u.pathname.replace("/b", "")); return new Response(null, { status: 204 }); },
  });
  const { hostFor } = await import("../src/accounts.mjs");
  const host = await hostFor(store, { secrets, fetch: n.fetch });
  const r = await testHost(host, file, "text/plain", { fetch: n.fetch });
  assert.match(r.url, /^https:\/\/media\.example\.test\/knitted\//);
  assert.equal(kept.size, 0);
  const closed = net({ "PUT s3.example.test/b/*": () => new Response(null, { status: 200 }), "GET media.example.test/*": () => new Response("no", { status: 403 }), "DELETE s3.example.test/b/*": () => new Response(null, { status: 204 }) });
  await assert.rejects(testHost(await hostFor(store, { secrets, fetch: closed.fetch }), file, "text/plain", { fetch: closed.fetch }), /has to let anyone read it/);
  assert.equal(listAccounts(store).length, 0);
});
