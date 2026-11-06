// Which chat the Ask page and the editor's Ask panel open: the one the person is having, wherever
// it can go on, so the two are one conversation (apps/studio/lib/current-chat.ts).
import assert from "node:assert/strict";
import test from "node:test";
import { chatHere } from "../apps/studio/lib/current-chat.ts";

const chat = (id, projectId) => ({ id, projectId, title: id, patternId: null, createdAt: "", updatedAt: "", running: false, project: null, pattern: null });
// Newest first, as the studio lists them.
const chats = [chat("studio", null), chat("notch", "pj_notch"), chat("ff", "pj_ff")];

test("the chat being had opens on the Ask page, whatever it is about", () => {
  assert.equal(chatHere(chats, "ff"), "ff");
  assert.equal(chatHere(chats, "notch"), "notch");
});

test("in a project it goes on if it is about that project, or about the whole studio", () => {
  assert.equal(chatHere(chats, "notch", "pj_notch"), "notch");
  assert.equal(chatHere(chats, "studio", "pj_notch"), "studio", "a chat about the whole studio goes on anywhere");
});

test("in another project a new chat starts, rather than one about somewhere else going on there", () => {
  assert.equal(chatHere(chats, "ff", "pj_notch"), null);
});

test("after New chat, every side shows a new one until its first message", () => {
  assert.equal(chatHere(chats, null), null);
  assert.equal(chatHere(chats, null, "pj_notch"), null);
});

test("until one is known, the one being had is the newest; a chat deleted since counts as not known", () => {
  assert.equal(chatHere(chats, undefined), "studio");
  assert.equal(chatHere(chats.slice(1), undefined, "pj_ff"), null, "the newest is about another project");
  assert.equal(chatHere(chats, "ch_gone"), "studio");
  assert.equal(chatHere([], undefined), null, "no chats yet: a new one");
});
