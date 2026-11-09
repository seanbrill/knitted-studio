// Chats: conversations with the studio's own model, on the Ask page and in the editor.
//
// A chat keeps the conversation exactly as the model had it: its instructions as they
// were when the chat started (`system`), and every message sent and answered, thinking
// and all (`messages`). The next turn sends both back byte for byte and adds to the end.
// The model's thinking is bound to the conversation that produced it, so a history
// edited along the way (an old message trimmed, the instructions rewritten) loses it
// that thinking, and the prompt cache with it. What the person sees of a turn is the
// run that answered it: a job, like a knit (`jobIds`).

import sharp from "sharp";
import { newId } from "./ids.ts";
import { NotFoundError, type Store } from "./store.ts";

export interface Chat {
  id: string;
  /** The project it works in, or null for the whole studio. */
  projectId: string | null;
  /** The pattern it was started on, in the editor. */
  patternId: string | null;
  title: string;
  system: string;
  messages: unknown[];
  /** The runs that answered it, oldest first: one per message the person sent. */
  jobIds: string[];
  createdAt: string;
  updatedAt: string;
}
export type ChatSummary = Omit<Chat, "system" | "messages">;
type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const summary = (r: Row): ChatSummary => ({
  id: r.id as string, projectId: (r.project_id as string) ?? null, patternId: (r.pattern_id as string) ?? null, title: r.title as string,
  jobIds: JSON.parse(r.job_ids as string), createdAt: r.created_at as string, updatedAt: r.updated_at as string,
});

/** One line, cut at a word near 60 characters. */
function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= 60) return line || "New chat";
  const cut = line.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 60)}...`;
}

/**
 * What a chat is called in the list: what the person asked, on one line. Asked from a button
 * about something, the prompt is that thing's context, then "What I want:" and their words:
 * the chat is named for their words, not for the context.
 */
export function chatTitle(prompt: string): string {
  const at = prompt.lastIndexOf("\n\nWhat I want: ");
  return oneLine(at < 0 ? prompt : prompt.slice(at + "\n\nWhat I want: ".length));
}

/** The first thing the person sent, as text. */
function firstAsk(messages: unknown[]): string | null {
  const m = messages[0] as { role?: string; content?: unknown } | undefined;
  if (!m || m.role !== "user") return null;
  if (typeof m.content === "string") return m.content;
  if (!Array.isArray(m.content)) return null;
  const text = m.content.filter((b: { type?: string }) => b?.type === "text").map((b: { text?: string }) => b.text ?? "").join("\n\n");
  return text || null;
}

/**
 * Chats started before titles named what was asked are named for their context. Once, name
 * each again from its first message, unless its title is no longer the one it was given.
 */
function retitleOnce(store: Store) {
  const done = store.db.prepare("select value from meta where key = 'chat-titles'").get() as { value: string } | undefined;
  if (done?.value === "2") return;
  store.write(() => {
    for (const r of store.db.prepare("select id, title, messages from chats").all() as Row[]) {
      // Without what the studio adds after the person's words: the pattern open, or the project.
      const ask = firstAsk(JSON.parse(r.messages as string))?.split(/\n\n(?:You are working on this pattern \(|\(Project |\(No project is open\.)/)[0];
      if (!ask || oneLine(ask) !== r.title) continue;
      const title = chatTitle(ask);
      if (title !== r.title) store.db.prepare("update chats set title = ? where id = ?").run(title, r.id as string);
    }
    store.db.prepare("insert into meta (key, value) values ('chat-titles', '2') on conflict(key) do update set value = excluded.value").run();
  });
}

export function createChat(store: Store, c: { projectId?: string | null; patternId?: string | null; title: string; system: string }): Chat {
  const id = newId("ch"), t = now();
  store.write(() => store.db.prepare("insert into chats (id, project_id, pattern_id, title, system, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)")
    .run(id, c.projectId ?? null, c.patternId ?? null, chatTitle(c.title), c.system, t, t));
  return getChat(store, id);
}

export function getChat(store: Store, id: string): Chat {
  const r = store.db.prepare("select * from chats where id = ?").get(id) as Row | undefined;
  if (!r) throw new NotFoundError("That chat is not here any more.");
  return { ...summary(r), system: r.system as string, messages: JSON.parse(r.messages as string) };
}

const SUMMARY = "select id, project_id, pattern_id, title, job_ids, created_at, updated_at from chats";

/** A chat without its conversation, which can be large: what the studio shows of it. */
export function chatSummary(store: Store, id: string): ChatSummary {
  const r = store.db.prepare(`${SUMMARY} where id = ?`).get(id) as Row | undefined;
  if (!r) throw new NotFoundError("That chat is not here any more.");
  return summary(r);
}

/** Newest first, without the conversations themselves. */
export function listChats(store: Store, f: { projectId?: string; patternId?: string; limit?: number } = {}): ChatSummary[] {
  retitleOnce(store);
  const where: string[] = []; const args: (string | number)[] = [];
  if (f.projectId) { where.push("project_id = ?"); args.push(f.projectId); }
  if (f.patternId) { where.push("pattern_id = ?"); args.push(f.patternId); }
  return (store.db.prepare(`${SUMMARY} ${where.length ? `where ${where.join(" and ")}` : ""} order by updated_at desc, rowid desc limit ?`)
    .all(...args, f.limit ?? 100) as Row[]).map(summary);
}

/** A turn starting: the run that will answer it. */
export function addChatRun(store: Store, id: string, jobId: string) {
  store.write(() => {
    const r = store.db.prepare("select job_ids from chats where id = ?").get(id) as Row | undefined;
    if (!r) throw new NotFoundError("That chat is not here any more.");
    store.db.prepare("update chats set job_ids = ?, updated_at = ? where id = ?").run(JSON.stringify([...JSON.parse(r.job_ids as string), jobId]), now(), id);
  });
}

/** The conversation after a turn, which only ever grows: what was there is sent again as it was. */
export function saveChatMessages(store: Store, id: string, messages: unknown[]) {
  store.write(() => store.db.prepare("update chats set messages = ?, updated_at = ? where id = ?").run(JSON.stringify(messages), now(), id));
}

/** Only the conversation goes. What the model made stays, and so does the log of its runs. */
export function deleteChat(store: Store, id: string) {
  chatSummary(store, id);
  store.write(() => store.db.prepare("delete from chats where id = ?").run(id));
}

/**
 * A picture for a model's conversation, which goes to the model again on every later
 * turn: no larger than the model reads it (about 1.15 megapixels, at most 1568px on the
 * long side), as WebP. A full-size PNG of a story is megabytes, and a few of those in one
 * chat would pass the most a single request may carry.
 */
export async function imageForModel(png: Buffer): Promise<{ data: Buffer; mime: string }> {
  const img = sharp(png);
  const { width = 0, height = 0 } = await img.metadata();
  if (!width || !height) return { data: png, mime: "image/png" };
  const k = Math.min(1, 1568 / Math.max(width, height), Math.sqrt(1_150_000 / (width * height)));
  const data = await img.resize(Math.max(1, Math.floor(width * k)), Math.max(1, Math.floor(height * k))).webp({ quality: 85 }).toBuffer();
  return { data, mime: "image/webp" };
}
