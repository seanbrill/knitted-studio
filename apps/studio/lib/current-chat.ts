"use client";

// The chat the person is having: the one the Ask page and the editor's Ask panel both open,
// so the two are one conversation. Kept on this computer, as the sidebar's state is. Whichever
// of them opens a chat, starts one or sends in one makes it this; New chat makes it none yet.

import { useEffect, useState } from "react";
import type { ChatItem } from "@knitted/core/client";

const KEY = "knitted.chat";
const changed = new Set<() => void>();

/** An id; null after New chat, until its first message starts one; undefined before any was opened here. */
function read(): string | null | undefined {
  try { const v = localStorage.getItem(KEY); return v === null ? undefined : v || null; } catch { return undefined; }
}

export function setCurrentChat(id: string | null) {
  try { localStorage.setItem(KEY, id ?? ""); } catch {}
  for (const f of changed) f();
}

/**
 * The chat being had, kept up as it changes here or in another window. Kept as component state,
 * so a change lands in the same render as one to the list of chats made with it.
 */
export function useCurrentChat() {
  const [id, setId] = useState(read);
  useEffect(() => {
    const f = () => setId(read());
    f();
    changed.add(f);
    window.addEventListener("storage", f);
    return () => { changed.delete(f); window.removeEventListener("storage", f); };
  }, []);
  return id;
}

/**
 * Which chat opens where the person is: the one they are having, if it can go on there, else a
 * new one (null). A chat about a project goes on anywhere in it, and one about the whole studio
 * anywhere at all. `projectId`: a project's page or its editor; none for the Ask page, where any
 * chat goes on. Until one is known (none opened yet, or it was deleted), it is the newest.
 */
export function chatHere(chats: ChatItem[], current: string | null | undefined, projectId?: string | null): string | null {
  if (current === null) return null;
  const mine = chats.find((c) => c.id === current) ?? chats[0];
  return mine && (!projectId || !mine.projectId || mine.projectId === projectId) ? mine.id : null;
}
