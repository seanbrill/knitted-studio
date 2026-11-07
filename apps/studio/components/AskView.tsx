"use client";

// Ask: conversations with your model, each about a project or about the whole studio.
// The chats are on the left, newest first. It opens the chat the person is having, the one
// the editor's Ask panel opens too, so the two are one conversation (lib/current-chat.ts).

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api } from "@knitted/core/client";
import { Button, IconButton, Select, Skeleton, icons } from "@knitted/ui";
import { chatHere, setCurrentChat, useCurrentChat } from "@/lib/current-chat";
import { useLive } from "@/lib/hooks";
import { Chat, ChatList, useChats } from "./Chat";

const { Plus, PanelLeftClose, PanelLeftOpen } = icons;
const FOLDED = "knitted.ask.chatsFolded";
// The choice "the whole studio": a Select item cannot have an empty value.
const STUDIO = "studio";
const ALL = "all";

export function AskView() {
  return <Suspense><AskInner /></Suspense>;
}

function AskInner() {
  const params = useSearchParams();
  const router = useRouter();
  const chatId = params.get("chat");
  const asked = params.get("project");
  const current = useCurrentChat();
  const { chats: list, started } = useChats();
  const { data: projects, error: noProjects } = useLive(() => api.projects.list(), []);
  const [chosen, setChosen] = useState<string | null>(null);
  // Which project's chats the list shows: each project's apart, so they are not mixed up.
  const [from, setFrom] = useState<string | null>(null);
  // The list of chats can be folded away for room to read; this computer remembers.
  const [folded, setFolded] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setFolded(localStorage.getItem(FOLDED) === "1"); }, []);
  const fold = (v: boolean) => { setFolded(v); localStorage.setItem(FOLDED, v ? "1" : "0"); };

  // The chat in the address, else the one being had. From a project's page, that one if it can go on
  // in the project, else a new one there. Whichever opens is the one being had from now on.
  const shown = chatId ?? (list ? chatHere(list, current, asked) : undefined);
  const chat = list?.find((c) => c.id === shown) ?? null;
  useEffect(() => { if (!chatId && shown) router.replace(`/ask?chat=${shown}`); }, [chatId, shown, router]);
  useEffect(() => { if (chat) setCurrentChat(chat.id); }, [chat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new chat works in the project named in the address, or the one worked on last, until another is picked.
  // Not before the projects are known, so a quick first message cannot go to the wrong place.
  const place = chosen ?? (asked && (!projects || projects.some((p) => p.id === asked)) ? asked : projects?.[0]?.id ?? STUDIO);
  const ready = !!shown || (shown === null && (!!projects || !!noProjects));
  const showing = from ?? (chat ? chat.projectId ?? STUDIO : asked ?? ALL);
  const listed = list?.filter((c) => showing === ALL || (c.projectId ?? STUDIO) === showing);

  // An address for a chat that is gone (deleted, say) opens the one being had, or a new one.
  const gone = !!list && !!chatId && !list.some((c) => c.id === chatId);
  useEffect(() => {
    if (!gone) return;
    if (current === chatId) setCurrentChat(null);
    router.replace("/ask");
  }, [gone]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {folded ? (
        <aside aria-label="Chats" style={{ width: 52, flexShrink: 0, borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: "var(--space-6)" }}>
          <IconButton label="Show the chats" onClick={() => fold(false)}><PanelLeftOpen size={16} aria-hidden /></IconButton>
          <IconButton label="New chat" disabled={!shown} onClick={() => { setCurrentChat(null); router.push(chat?.projectId ? `/ask?project=${chat.projectId}` : "/ask"); }}><Plus size={16} aria-hidden /></IconButton>
        </aside>
      ) : (
      <aside aria-label="Chats" style={{ width: 248, flexShrink: 0, borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "var(--space-6) var(--space-4) var(--space-3)" }}>
          <h2 className="label" style={{ margin: 0 }}>Chats</h2>
          <div style={{ display: "flex", gap: 4 }}>
            <Button size="sm" disabled={!shown} onClick={() => { setCurrentChat(null); router.push(chat?.projectId ? `/ask?project=${chat.projectId}` : "/ask"); }}><Plus size={14} aria-hidden /> New chat</Button>
            <IconButton label="Hide the chats" onClick={() => fold(true)}><PanelLeftClose size={16} aria-hidden /></IconButton>
          </div>
        </div>
        <div style={{ padding: "0 var(--space-4) var(--space-3)" }}>
          <Select aria-label="Show the chats of" value={showing} onValueChange={setFrom}
            options={[{ value: ALL, label: "Every project" }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })), { value: STUDIO, label: "The whole studio" }]} />
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: "0 var(--space-2) var(--space-4)" }}>
          {listed && <ChatList chats={listed} shown={shown ?? null} href={(c) => `/ask?chat=${c.id}`} onDeleted={(c) => { if (c.id === shown) router.replace("/ask"); }} />}
        </div>
      </aside>
      )}
      <section aria-label={chat ? chat.title : "New chat"} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <header style={{ padding: "var(--space-6) var(--space-8) var(--space-4)", borderBottom: "1px solid var(--line)", display: "grid", gap: "var(--space-2)" }}>
          <p className="eyebrow" style={{ margin: 0 }}>Ask your model</p>
          <h1 className="h2" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chat ? chat.title : shown !== null ? " " : "New chat"}</h1>
          {chat ? (
            <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>
              {chat.pattern ? <>About <Link className="link" href={`/projects/${chat.pattern.projectId}/patterns/${chat.pattern.id}`}>{chat.pattern.name}</Link>{chat.project ? `, in ${chat.project.name}` : ""}</>
                : chat.project ? <>In <Link className="link" href={`/projects/${chat.project.id}`}>{chat.project.name}</Link></>
                : "About the whole studio"}
            </p>
          ) : shown === null && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="body-sm" style={{ color: "var(--ink-muted)" }}>Works in</span>
              <div style={{ minWidth: 220 }}>
                {ready ? <Select aria-label="Where your model works" value={place} onValueChange={setChosen}
                  options={[...(projects ?? []).map((p) => ({ value: p.id, label: p.name })), { value: STUDIO, label: "The whole studio" }]} /> : <Skeleton height={36} />}
              </div>
            </div>
          )}
        </header>
        {ready ? <Chat key={shown ?? "new"} chatId={shown ?? null} projectId={place === STUDIO ? null : place} patternId={chat?.pattern?.id}
          onStarted={(c) => { started(c); router.replace(`/ask?chat=${c.id}`); }} /> : <div style={{ padding: "var(--space-8)" }}><Skeleton height={80} /></div>}
      </section>
    </div>
  );
}
