import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { addChatRun, chatSummary, chatTitle, createChat, deleteChat, getChat, imageForModel, listChats, NotFoundError, openStore, saveChatMessages } from "../src/node.ts";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-chats-")), "k.db"));
const project = store.createProject({ name: "Talk", starter: "social" });
const [pattern] = store.listPatterns(project.id);

test("a chat is named for the first thing asked, on one line, cut at a word", () => {
  assert.equal(chatTitle("  Make the\nheadline   bigger "), "Make the headline bigger");
  const long = chatTitle("Write three headlines for the spring sale that sound like us and not like a discount warehouse");
  assert.ok(long.length <= 63 && long.endsWith("..."), long);
  assert.doesNotMatch(long, /\s\.\.\.$/);
  assert.equal(chatTitle("   "), "New chat");
});

test("a chat asked from a button about something is named for what the person wants, not the context", () => {
  const prompt = "This is the pattern Launch story, a story 1080 x 1920, with slots headline and photo.\n\nWhat I want: Make the logo smaller";
  assert.equal(chatTitle(prompt), "Make the logo smaller");
});

test("a short ask is named for itself, without what the studio adds after it", () => {
  const short = createChat(store, { projectId: project.id, title: "This is about the knit Spring sale.\n\nWhat I want: Bigger logo", system: "The rules." });
  saveChatMessages(store, short.id, [{ role: "user", content: `This is about the knit Spring sale.\n\nWhat I want: Bigger logo\n\n(Project ${project.id}. No pattern is open.)` }]);
  store.db.prepare("update chats set title = ? where id = ?").run("This is about the knit Spring sale. What I want: Bigger logo", short.id);
  store.db.prepare("delete from meta where key = 'chat-titles'").run();
  assert.equal(listChats(store).find((c) => c.id === short.id).title, "Bigger logo");
  deleteChat(store, short.id);
});

test("chats named for their context before are named again once, from their first message; a title changed since is kept", () => {
  const ask = "This is the knit Spring sale, a post 1080 x 1350, in the folder Posts.\n\nWhat I want: Knit it again in the story size";
  const old = createChat(store, { projectId: project.id, title: ask, system: "The rules." });
  const kept = createChat(store, { projectId: project.id, title: ask, system: "The rules." });
  // As the studio sends it: with the project it is in after the person's words.
  for (const c of [old, kept]) saveChatMessages(store, c.id, [{ role: "user", content: [{ type: "text", text: `${ask}\n\n(Project ${project.id}. No pattern is open.)` }] }]);
  // As the earlier rule named them: the whole prompt on one line, cut near 60.
  store.db.prepare("update chats set title = ? where id = ?").run("This is the knit Spring sale, a post 1080 x 1350, in the...", old.id);
  store.db.prepare("update chats set title = ? where id = ?").run("The story size", kept.id);
  store.db.prepare("delete from meta where key = 'chat-titles'").run();
  const titles = Object.fromEntries(listChats(store).map((c) => [c.id, c.title]));
  assert.equal(titles[old.id], "Knit it again in the story size");
  assert.equal(titles[kept.id], "The story size");
  // Once: a title set later is not touched again.
  store.db.prepare("update chats set title = ? where id = ?").run("This is the knit Spring sale, a post 1080 x 1350, in the...", old.id);
  assert.equal(listChats(store).find((c) => c.id === old.id).title, "This is the knit Spring sale, a post 1080 x 1350, in the...");
  for (const c of [old, kept]) deleteChat(store, c.id);
});

test("a chat keeps its conversation exactly, and its runs in order", () => {
  const c = createChat(store, { projectId: project.id, patternId: pattern.id, title: "Headline", system: "The rules." });
  assert.match(c.id, /^ch_/);
  assert.deepEqual(c.messages, []);
  const messages = [{ role: "user", content: "Headline" }, { role: "assistant", content: [{ type: "thinking", thinking: "Hm.", signature: "s" }, { type: "text", text: "Done." }] }];
  saveChatMessages(store, c.id, messages);
  addChatRun(store, c.id, "jb_1"); addChatRun(store, c.id, "jb_2");
  const back = getChat(store, c.id);
  assert.deepEqual(back.messages, messages);
  assert.equal(back.system, "The rules.");
  assert.deepEqual(back.jobIds, ["jb_1", "jb_2"]);
  assert.equal(chatSummary(store, c.id).messages, undefined, "a summary leaves the conversation out");
});

test("chats list newest first, by project or by pattern", async () => {
  const a = createChat(store, { projectId: project.id, title: "Older", system: "s" });
  const studio = createChat(store, { projectId: null, title: "About everything", system: "s" });
  await new Promise((r) => setTimeout(r, 5));
  addChatRun(store, a.id, "jb_9");
  assert.equal(listChats(store)[0].id, a.id, "a chat that was just answered comes first");
  assert.ok(listChats(store, { projectId: project.id }).every((c) => c.projectId === project.id));
  assert.ok(!listChats(store, { projectId: project.id }).some((c) => c.id === studio.id));
  assert.ok(listChats(store, { patternId: pattern.id }).every((c) => c.patternId === pattern.id));
});

test("deleting a chat takes only the conversation; deleting its pattern keeps the chat", () => {
  const c = createChat(store, { projectId: project.id, title: "Gone soon", system: "s" });
  deleteChat(store, c.id);
  assert.throws(() => getChat(store, c.id), NotFoundError);
  assert.throws(() => deleteChat(store, c.id), NotFoundError);

  const doomed = store.createPattern(project.id, { name: "Short-lived" });
  const about = createChat(store, { projectId: project.id, patternId: doomed.id, title: "About it", system: "s" });
  store.deletePattern(doomed.id);
  assert.equal(getChat(store, about.id).patternId, null);
});

test("a picture for the model is no larger than it reads, so a long chat stays sendable", async () => {
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#df5a0f" } }).png().toBuffer();
  const out = await imageForModel(big);
  const m = await sharp(out.data).metadata();
  assert.equal(out.mime, "image/webp");
  assert.equal(m.format, "webp");
  assert.ok(Math.max(m.width, m.height) <= 1568, `${m.width}x${m.height}`);
  assert.ok(m.width * m.height <= 1_150_000, `${m.width}x${m.height}`);
  assert.ok(Math.abs(m.width / m.height - 1.5) < 0.01, "the shape is kept");
  assert.ok(out.data.length < big.length);

  const small = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#fff" } }).png().toBuffer();
  const s = await sharp((await imageForModel(small)).data).metadata();
  assert.deepEqual([s.width, s.height], [400, 300], "a small one is not made bigger");
});
