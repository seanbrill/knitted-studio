import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captionLength, checkPost, fullCaption, xLength } from "../src/index.ts";
import { cancelPost, createPost, getPost, insertKnit, listPosts, openStore, recoverInterrupted, removeAccount, saveAccount, updatePost } from "../src/node.ts";

test("X counts a link as 23 and an emoji as 2; YouTube counts a description's bytes", () => {
  assert.equal(xLength("hi https://knitted.studio/a/very/long/path"), 3 + 23);
  assert.equal(xLength("ok 🎉"), 3 + 2);
  assert.equal(captionLength("youtube", "é"), 2);
  assert.equal(captionLength("instagram", "🎉🎉"), 2);
});

test("the caption gets the hashtags it does not already have", () => {
  assert.equal(fullCaption("Out now #launch", ["launch", "#winter"]), "Out now #launch\n\n#winter");
  assert.equal(fullCaption("Out now", []), "Out now");
});

test("each platform's refusals are said before scheduling, not found at the post's time", () => {
  const pic = { kind: "image", width: 1080, height: 1080 };
  const vid = (ms, w = 1080, h = 1920) => ({ kind: "video", width: w, height: h, durationMs: ms });
  assert.match(checkPost("tiktok", [pic], "x").problems[0], /TikTok takes videos only/);
  assert.match(checkPost("x", [pic, pic, pic, pic, pic], "x").problems[0], /up to 4 pictures/);
  assert.match(checkPost("x", [pic], "a".repeat(281)).problems[0], /281 long; X takes 280/);
  assert.match(checkPost("x", [vid(200_000)], "x").problems[0], /up to 2 minutes/);
  assert.match(checkPost("instagram", [pic, vid(5000)], "x").problems[0], /one video or pictures, not both/);
  assert.match(checkPost("youtube", [vid(5000)], "x").problems[0], /needs a title/);
  assert.match(checkPost("youtube", [vid(5000)], "x", "<b>").problems[0], /< or >/);
  assert.match(checkPost("instagram", [{ kind: "image", width: 1080, height: 1920 }], "x").notes[0], /goes to your Story/);
  assert.match(checkPost("instagram", [{ kind: "image", width: 2000, height: 500 }], "x").problems[0], /1\.91:1 at their widest/);
  assert.match(checkPost("youtube", [vid(30_000)], "x", "t").notes[0], /as a Short/);
  assert.deepEqual(checkPost("linkedin", [], "Words only").problems, [], "LinkedIn, X and Threads take words alone");
  assert.match(checkPost("instagram", [], "x").problems[0], /needs a picture or a video/);
});

const fresh = () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-social-core-")), "k.db"));
  const project = store.createProject({ name: "P" });
  const knit = insertKnit(store, { projectId: project.id, patternId: null, patternName: "P", jobId: null, batchId: null, label: "Post", file: "p.png", kind: "image", format: "png", width: 1080, height: 1080, bytes: 1, durationMs: null, hash: "h", report: {} });
  const account = saveAccount(store, { platform: "x", externalId: "42", name: "Knit", handle: "knit", avatar: null, scopes: [], expiresAt: null });
  return { store, project, knit, account };
};

test("a post is scheduled, moved, made a draft, and cancelled; a time long gone is refused", () => {
  const { store, project, knit, account } = fresh();
  const at = new Date(Date.now() + 3600_000).toISOString();
  const p = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [knit.id], caption: "Hi", at });
  assert.equal(p.status, "scheduled");
  assert.equal(p.scheduledAt, at);
  assert.throws(() => createPost(store, { projectId: project.id, accountId: account.id, knitIds: [knit.id], caption: "Hi", at: "2020-01-01T00:00:00Z" }), /That time has passed/);
  assert.equal(updatePost(store, p.id, { draft: true }).status, "draft");
  assert.equal(updatePost(store, p.id, { caption: "Changed" }).caption, "Changed");
  assert.throws(() => updatePost(store, p.id, { caption: "a".repeat(281) }), /X takes 280/);
  assert.equal(updatePost(store, p.id, { at }).status, "scheduled");
  assert.equal(cancelPost(store, p.id).status, "cancelled");
  assert.equal(listPosts(store, { projectId: project.id, status: ["cancelled"] }).length, 1);
});

test("signing in to an account already here renews it; disconnecting cancels what has not gone out, saying why", () => {
  const { store, project, knit, account } = fresh();
  const again = saveAccount(store, { platform: "x", externalId: "42", name: "Knit 2", handle: "knit", avatar: null, scopes: ["a"], expiresAt: null });
  assert.equal(again.id, account.id);
  assert.equal(again.name, "Knit 2");
  const p = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [knit.id], caption: "Hi", draft: true });
  removeAccount(store, account.id);
  assert.equal(getPost(store, p.id).status, "cancelled");
  assert.match(getPost(store, p.id).error, /disconnected before this went out/);
});

test("a post left mid-way when knitted stopped says to look before posting again", () => {
  const { store, project, knit, account } = fresh();
  const p = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [knit.id], caption: "Hi" });
  store.db.prepare("update social_posts set status = 'posting' where id = ?").run(p.id);
  assert.equal(recoverInterrupted(store), 1);
  assert.match(getPost(store, p.id).error, /it may be there/);
});
