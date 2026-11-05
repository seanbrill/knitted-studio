"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@knitted/core/client";
import { Button, Skeleton, icons } from "@knitted/ui";
import { useEditor } from "@/lib/editor/store";
import { useLive } from "@/lib/hooks";
import { Chat } from "../Chat";

const { Lock, Plus } = icons;

/**
 * Ask your model about this pattern, as a conversation: the newest chat on it opens here,
 * and the whole of it is on the Ask page too. It follows the locks you do, and what each
 * answer changed can be undone as one.
 */
export function AskPanel({ projectId }: { projectId: string }) {
  const st = useEditor();
  const patternId = st.pattern.id;
  const { data: chats, error } = useLive(() => api.chats.list({ pattern: patternId }), [patternId]);
  // Undefined: the newest chat on this pattern. Null: a new one, until its first message starts it.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const chatId = chosen === undefined ? chats?.[0]?.id ?? null : chosen;
  const lockedCount = st.pattern.stitches.filter((s) => s.locked).length;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <h2 className="label" style={{ margin: 0 }}>Ask your model</h2>
        {chatId && <Button size="sm" variant="ghost" onClick={() => setChosen(null)}><Plus size={14} aria-hidden /> New chat</Button>}
      </div>
      <span className="chip body-sm" style={{ display: "inline-flex", gap: 4, alignItems: "center", justifySelf: "start", alignSelf: "flex-start" }}>
        <Lock size={12} aria-hidden /> Working on {st.pattern.name}{lockedCount ? `, ${lockedCount} locked` : ""}
      </span>
      {chats || error
        ? <Chat key={chatId ?? "new"} compact chatId={chatId} projectId={projectId} patternId={patternId} onStarted={(c) => setChosen(c.id)} onChanged={() => void st.reload()} />
        : <Skeleton height={120} />}
      {chatId && <Link className="link body-sm" href={`/ask?chat=${chatId}`}>Open in Ask</Link>}
    </div>
  );
}
