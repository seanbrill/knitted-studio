"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Skeleton, icons } from "@knitted/ui";
import { chatHere, setCurrentChat, useCurrentChat } from "@/lib/current-chat";
import { useEditor } from "@/lib/editor/store";
import { Chat, ChatList, useChats } from "../Chat";

const { List, Lock, Plus } = icons;

/**
 * Ask your model about this pattern, as a conversation: the chat the person is having, the one
 * the Ask page opens too, when it can go on in this project; else a new one. A message sent from
 * here is about this pattern. It follows the locks you do, and what each answer changed can be
 * undone as one. Chats lists the others that can go on here, to open one instead.
 */
export function AskPanel({ projectId }: { projectId: string }) {
  const st = useEditor();
  const patternId = st.pattern.id;
  const current = useCurrentChat();
  const { chats, error, started } = useChats();
  const chatId = chats ? chatHere(chats, current, projectId) : null;
  const chat = chats?.find((c) => c.id === chatId) ?? null;
  // This project's chats, and those about the whole studio, which go on anywhere.
  // Only this project's chats, so a conversation about another project is never mixed in.
  const here = (chats ?? []).filter((c) => c.projectId === projectId);
  const [listing, setListing] = useState(false);
  const lockedCount = st.pattern.stitches.filter((s) => s.locked).length;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <h2 className="label" style={{ margin: 0 }}>Ask your model</h2>
        <Button size="sm" variant="ghost" aria-pressed={listing} onClick={() => setListing((l) => !l)}><List size={14} aria-hidden /> Chats</Button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32 }}>
        <p className="body-sm" style={{ margin: 0, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink-muted)" }}>{chat ? chat.title : "New chat"}</p>
        {chatId && <Button size="sm" variant="ghost" onClick={() => { setCurrentChat(null); setListing(false); }}><Plus size={14} aria-hidden /> New chat</Button>}
      </div>
      {listing ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "grid", alignContent: "start", gap: "var(--space-3)" }}>
          {chats ? <ChatList chats={here} shown={chatId} onOpen={(c) => { setCurrentChat(c.id); setListing(false); }} /> : <Skeleton height={120} />}
          <Link className="link body-sm" href="/ask">Every chat, on the Ask page</Link>
        </div>
      ) : (
        <>
          <span className="chip body-sm" style={{ display: "inline-flex", gap: 4, alignItems: "center", alignSelf: "flex-start" }}>
            <Lock size={12} aria-hidden /> Working on {st.pattern.name}{lockedCount ? `, ${lockedCount} locked` : ""}
          </span>
          {chats || error
            ? <Chat key={chatId ?? "new"} compact chatId={chatId} projectId={projectId} patternId={patternId} onStarted={started} onChanged={() => void st.reload()} />
            : <Skeleton height={120} />}
          {chatId && <Link className="link body-sm" href={`/ask?chat=${chatId}`}>Open in Ask</Link>}
        </>
      )}
    </div>
  );
}
