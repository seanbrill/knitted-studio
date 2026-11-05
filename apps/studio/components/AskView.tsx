"use client";

// Ask: conversations with your model, each about a project or about the whole studio.
// The chats are on the left, newest first; the editor's Ask panel starts them too, on a pattern.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, type ChatItem } from "@knitted/core/client";
import { Button, ConfirmDialog, IconButton, Select, Skeleton, icons } from "@knitted/ui";
import { timeAgo, useLive } from "@/lib/hooks";
import { Chat } from "./Chat";

const { Plus, Trash2 } = icons;
// The choice "the whole studio": a Select item cannot have an empty value.
const STUDIO = "studio";

const placeOf = (c: ChatItem) => c.pattern ? `${c.pattern.name}${c.project ? `, ${c.project.name}` : ""}` : c.project ? c.project.name : "The whole studio";

export function AskView() {
  return <Suspense><AskInner /></Suspense>;
}

function AskInner() {
  const params = useSearchParams();
  const router = useRouter();
  const chatId = params.get("chat");
  const { data: chats } = useLive(() => api.chats.list(), []);
  const { data: projects, error: noProjects } = useLive(() => api.projects.list(), []);
  const [chosen, setChosen] = useState<string | null>(null);
  const [doomed, setDoomed] = useState<ChatItem | null>(null);
  // The chat just started here, until the list catches up with it a moment later.
  const [fresh, setFresh] = useState<ChatItem | null>(null);
  const list = chats && fresh && !chats.some((c) => c.id === fresh.id) ? [fresh, ...chats] : chats;
  const current = list?.find((c) => c.id === chatId) ?? null;

  // A new chat works in the project named in the address, or the one worked on last, until another is picked.
  // Not before the projects are known, so a quick first message cannot go to the wrong place.
  const asked = params.get("project");
  const place = chosen ?? (asked && (!projects || projects.some((p) => p.id === asked)) ? asked : projects?.[0]?.id ?? STUDIO);
  const ready = !!chatId || !!projects || !!noProjects;

  // An address for a chat that is gone (deleted, say) opens a new one.
  const gone = !!list && !!chatId && !list.some((c) => c.id === chatId);
  useEffect(() => { if (gone) router.replace("/ask"); }, [gone, router]);

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <aside aria-label="Chats" style={{ width: 248, flexShrink: 0, borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "var(--space-6) var(--space-4) var(--space-3)" }}>
          <h2 className="label" style={{ margin: 0 }}>Chats</h2>
          <Button size="sm" onClick={() => router.push(current?.projectId ? `/ask?project=${current.projectId}` : "/ask")} disabled={!chatId}><Plus size={14} aria-hidden /> New chat</Button>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: "0 var(--space-2) var(--space-4)", overflowY: "auto", flex: 1, display: "grid", alignContent: "start", gap: 2 }}>
          {list?.length === 0 && <li className="body-sm" style={{ padding: "var(--space-2)", color: "var(--ink-muted)" }}>Your conversations show here.</li>}
          {list?.map((c) => {
            const on = c.id === chatId;
            return (
              <li key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: "var(--radius-md)", background: on ? "var(--tint)" : undefined }}>
                <Link href={`/ask?chat=${c.id}`} aria-current={on ? "page" : undefined} style={{ flex: 1, minWidth: 0, display: "grid", gap: 2, padding: "8px 10px", color: "inherit" }}>
                  <span className="label" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
                  <span className="body-sm" style={{ color: "var(--ink-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.running ? "Answering..." : timeAgo(c.updatedAt)}, {placeOf(c)}
                  </span>
                </Link>
                <IconButton label={`Delete the chat "${c.title}"`} onClick={() => setDoomed(c)} style={{ flexShrink: 0, marginRight: 4 }}><Trash2 size={14} aria-hidden /></IconButton>
              </li>
            );
          })}
        </ul>
      </aside>
      <section aria-label={current ? current.title : "New chat"} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <header style={{ padding: "var(--space-6) var(--space-8) var(--space-4)", borderBottom: "1px solid var(--line)", display: "grid", gap: "var(--space-2)" }}>
          <p className="eyebrow" style={{ margin: 0 }}>Ask your model</p>
          <h1 className="h2" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current ? current.title : chatId ? " " : "New chat"}</h1>
          {current ? (
            <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>
              {current.pattern && current.project ? <>About <Link className="link" href={`/projects/${current.project.id}/patterns/${current.pattern.id}`}>{current.pattern.name}</Link>, in {current.project.name}</>
                : current.project ? <>In <Link className="link" href={`/projects/${current.project.id}`}>{current.project.name}</Link></>
                : "About the whole studio"}
            </p>
          ) : !chatId && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="body-sm" style={{ color: "var(--ink-muted)" }}>Works in</span>
              <div style={{ minWidth: 220 }}>
                {ready ? <Select aria-label="Where your model works" value={place} onValueChange={setChosen}
                  options={[...(projects ?? []).map((p) => ({ value: p.id, label: p.name })), { value: STUDIO, label: "The whole studio" }]} /> : <Skeleton height={36} />}
              </div>
            </div>
          )}
        </header>
        {ready ? <Chat key={chatId ?? "new"} chatId={chatId} projectId={place === STUDIO ? null : place}
          onStarted={(c) => { setFresh(c); router.replace(`/ask?chat=${c.id}`); }} /> : <div style={{ padding: "var(--space-8)" }}><Skeleton height={80} /></div>}
      </section>
      <ConfirmDialog open={!!doomed} onOpenChange={(o) => { if (!o) setDoomed(null); }} title="Delete this chat?" confirmLabel="Delete chat"
        description="The conversation goes. What your model made stays, and so does its history in each pattern."
        onConfirm={async () => { const c = doomed!; await api.chats.remove(c.id); if (c.id === fresh?.id) setFresh(null); if (c.id === chatId) router.replace("/ask"); }} />
    </div>
  );
}
