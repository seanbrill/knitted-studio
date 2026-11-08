// Comments pinned to a spot on a knit (at a moment, in a video) or a frame of a design sheet,
// with replies, by the person or their model, until one of them resolves it.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addComment, changeDesign, createDesign, deleteComment, deleteKnit, editComment, getComment, insertKnit, listComments, openCommentCounts, openStore, replyComment, resolveComment } from "../src/node.ts";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-comments-")), "k.db"));
const p = store.createProject({ name: "Northwind" });
const knit = (label, kind = "image") => insertKnit(store, { projectId: p.id, patternId: null, patternName: "Launch", jobId: null, batchId: null, label, file: `day/${label}`, kind, format: kind === "video" ? "mp4" : "png", width: 1080, height: 1920, bytes: 1, durationMs: kind === "video" ? 8000 : null, hash: label, report: {} });

test("a comment is pinned to a spot on a knit, numbered, and kept with what it says and who said it", () => {
  const k = knit("story");
  const a = addComment(store, { knitId: k.id, x: 0.25, y: 0.123456, text: "  Make this bigger  " });
  assert.equal(a.n, 1);
  assert.equal(a.text, "Make this bigger");
  assert.equal(a.author, "human");
  assert.deepEqual([a.x, a.y, a.timeMs], [0.25, 0.1235, null]);
  assert.equal(a.on, "story");
  const b = addComment(store, { knitId: k.id, text: "Overall, too busy" }, "model");
  assert.equal(b.n, 2);
  assert.equal(b.x, null, "a comment on the whole thing has no pin");
  assert.equal(b.author, "model");
  assert.deepEqual(listComments(store, { knitId: k.id }).map((c) => c.n), [1, 2]);
  assert.equal(store.activity(p.id, 5).some((r) => r.action === "comment.added"), true);
});

test("in a video a comment is at a moment, within the video", () => {
  const v = knit("reel", "video");
  assert.equal(addComment(store, { knitId: v.id, x: 0.5, y: 0.5, timeMs: 3200.4, text: "Here the words come in too late" }).timeMs, 3200);
  assert.throws(() => addComment(store, { knitId: v.id, x: 0.5, y: 0.5, timeMs: 9000, text: "x" }), /from 0 to 8000/);
  assert.throws(() => addComment(store, { knitId: knit("still").id, timeMs: 10, text: "x" }), /Only a video has moments/);
});

test("a pin is where it can be, and a comment says something", () => {
  const k = knit("bad");
  assert.throws(() => addComment(store, { knitId: k.id, x: 1.2, y: 0.5, text: "x" }), /fraction from 0 to 1/);
  assert.throws(() => addComment(store, { knitId: k.id, x: 0.2, text: "x" }), /both x and y/);
  assert.throws(() => addComment(store, { knitId: k.id, text: "   " }), /Write the comment first/);
  assert.throws(() => addComment(store, { text: "x" }), /a knit \(knitId\) or a design sheet/);
});

test("on a design sheet a pin is on a frame, and the thread says which", () => {
  const d = createDesign(store, p.id, { name: "Site", start: "blank" });
  const made = changeDesign(store, d.id, [{ op: "addSection", name: "Pages" }, { op: "setFrame", section: "Pages", name: "Home", width: 1440, html: "<h1>Hi</h1>", css: "" }]);
  const frameId = made.made.frames[0];
  const c = addComment(store, { designId: d.id, frameId, x: 0.1, y: 0.9, text: "The footer is cramped" });
  assert.equal(c.frameId, frameId);
  assert.equal(c.frameName, "Home");
  assert.equal(c.on, "Site");
  assert.throws(() => addComment(store, { designId: d.id, frameId: "f999", x: 0.1, y: 0.1, text: "x" }), /has no frame f999/);
  assert.throws(() => addComment(store, { designId: d.id, x: 0.1, y: 0.1, text: "x" }), /give its frameId/);
  assert.equal(addComment(store, { designId: d.id, text: "The whole sheet needs more air" }).frameId, null);
  assert.equal(listComments(store, { designId: d.id, frameId }).length, 1);
});

test("replies follow the comment, and either of them resolves it or opens it again", () => {
  const k = knit("thread");
  const c = addComment(store, { knitId: k.id, x: 0.5, y: 0.5, text: "Logo too small" });
  let t = replyComment(store, c.id, { text: "Made it 20% bigger and knitted it again.", resolve: true }, "model");
  assert.equal(t.replies.length, 1);
  assert.equal(t.replies[0].author, "model");
  assert.ok(t.resolvedAt);
  assert.deepEqual(listComments(store, { knitId: k.id, open: true }), [], "resolved, it is not open");
  t = replyComment(store, t.replies[0].id, { text: "Still small. Bigger again?" });
  assert.equal(t.replies.length, 2, "a reply to a reply goes in the same thread");
  assert.ok(t.resolvedAt, "a reply alone leaves it as it was");
  assert.equal(resolveComment(store, c.id, false).resolvedAt, null);
  assert.equal(openCommentCounts(store, p.id)[k.id], 1);
  assert.equal(getComment(store, t.replies[1].id).id, c.id, "a reply's id finds its thread");
});

test("only its author changes what a comment says, and deleting one takes its replies with it", () => {
  const k = knit("own");
  const c = addComment(store, { knitId: k.id, text: "Warmer colours" });
  assert.throws(() => editComment(store, c.id, "Cooler colours", "model"), /the person's comment/);
  assert.equal(editComment(store, c.id, "Warmer colours, please").text, "Warmer colours, please");
  const t = replyComment(store, c.id, { text: "On it." }, "model");
  deleteComment(store, t.replies[0].id);
  assert.equal(getComment(store, c.id).replies.length, 0);
  replyComment(store, c.id, { text: "Again." }, "model");
  deleteComment(store, c.id);
  assert.throws(() => getComment(store, c.id), /not here any more/);
});

test("a knit's comments go with it when it is deleted", async () => {
  const k = knit("gone");
  addComment(store, { knitId: k.id, text: "x" });
  await deleteKnit(store, k.id).catch(() => {});
  assert.deepEqual(listComments(store, { knitId: k.id }), []);
});
