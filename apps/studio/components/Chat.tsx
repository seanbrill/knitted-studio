"use client";

// A conversation with your model: the Ask page, and the editor's Ask panel (`compact`). Both
// open the chat the person is having (lib/current-chat.ts), list the chats the same way, and
// go on with the same conversation, so it is one wherever they are.
//
// What it shows is the chat's runs, one per message (api/chats): what the person asked,
// what the model did while it worked, and its answer, kept up through the change stream,
// so each step appears as the model takes it. The conversation the model itself reads is
// kept on the server, word for word (packages/core/src/chats.ts).

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, type AgentEvent, type AgentJob, type ChatDetail, type ChatItem } from "@knitted/core/client";
import { Button, ConfirmDialog, IconButton, Textarea, icons, useToast } from "@knitted/ui";
import { setCurrentChat, useCurrentChat } from "@/lib/current-chat";
import { timeAgo, useLive } from "@/lib/hooks";

const { AlertTriangle, Check, Sparkles, Trash2, X } = icons;

const answering = (j?: AgentJob | null) => !!j && (j.status === "queued" || j.status === "running");
const words = (tool: string) => tool.replace(/_/g, " ");

// The runs sent or seen answering from this window. When one ends, whatever shows its work
// reloads. Kept outside the component, as the first message of a chat remounts it.
const watched = new Set<string>();
// A chat just started, as its start answered: shown at once, while the chat itself loads.
const seeded = new Map<string, ChatDetail>();

type Step = { kind: "say" | "tool" | "refused"; text: string; state?: "running" | "done" | "failed" };
/** What a run did, a line a step: what the model said along the way, each tool and how it went, what a lock refused. */
function stepsOf(events: AgentEvent[], answer?: string): Step[] {
  const out: Step[] = [];
  for (const e of events) {
    if (e.type === "text" || e.type === "note") { if (e.text !== answer) out.push({ kind: "say", text: e.text }); }
    else if (e.type === "tool_call") out.push({ kind: "tool", text: words(e.name), state: "running" });
    else if (e.type === "tool_result") {
      const t = [...out].reverse().find((s) => s.kind === "tool" && s.state === "running" && s.text === words(e.name));
      if (t) { t.state = e.summary.startsWith("failed") ? "failed" : "done"; if (t.state === "failed") t.text += `: ${e.summary.replace(/^failed: /, "")}`; }
    }
    else if (e.type === "refusal") out.push({ kind: "refused", text: `Could not change ${e.slot}: ${e.why}` });
  }
  return out;
}

/** The chats, newest first. One started here is in it at once, ahead of the change stream bringing it. */
export function useChats() {
  const { data, error } = useLive(() => api.chats.list(), []);
  const [fresh, setFresh] = useState<ChatItem | null>(null);
  // Once listed it is let go, so a chat deleted later does not come back.
  if (fresh && data?.some((c) => c.id === fresh.id)) setFresh(null);
  return { chats: data && fresh ? [fresh, ...data.filter((c) => c.id !== fresh.id)] : data, error, started: setFresh };
}

const placeOf = (c: ChatItem) => c.pattern ? `${c.pattern.name}${c.project ? `, ${c.project.name}` : ""}` : c.project ? c.project.name : "The whole studio";
const oneLine = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

/**
 * The chats as the Ask page and the editor's Ask panel list them: what each is, when, and where,
 * to open one or delete it. A link to each on the Ask page (`href`), a button in the panel (`onOpen`).
 */
export function ChatList({ chats, shown, href, onOpen, onDeleted }: {
  chats: ChatItem[];
  /** The chat open beside the list. */
  shown: string | null;
  href?: (c: ChatItem) => string;
  onOpen?: (c: ChatItem) => void;
  /** A chat is gone. Were it the one being had, or the one open, the next is a new one. */
  onDeleted?: (c: ChatItem) => void;
}) {
  const current = useCurrentChat();
  const [doomed, setDoomed] = useState<ChatItem | null>(null);
  const look = { flex: 1, minWidth: 0, display: "grid", gap: 2, padding: "8px 10px", color: "inherit" } as const;
  return (
    <>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", alignContent: "start", gap: 2 }}>
        {chats.length === 0 && <li className="body-sm" style={{ padding: "var(--space-2)", color: "var(--ink-muted)" }}>Your conversations show here.</li>}
        {chats.map((c) => {
          const on = c.id === shown;
          const what = (<>
            <span className="label" style={oneLine}>{c.title}</span>
            <span className="body-sm" style={{ color: "var(--ink-muted)", ...oneLine }}>{c.running ? "Answering..." : timeAgo(c.updatedAt)}, {placeOf(c)}</span>
          </>);
          return (
            <li key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: "var(--radius-md)", background: on ? "var(--tint)" : undefined }}>
              {href ? <Link href={href(c)} aria-current={on ? "page" : undefined} style={look}>{what}</Link>
                : <button type="button" aria-current={on || undefined} onClick={() => onOpen?.(c)} style={{ ...look, background: "transparent", border: 0, borderRadius: "var(--radius-md)", textAlign: "left", font: "inherit", cursor: "pointer" }}>{what}</button>}
              <IconButton label={`Delete the chat "${c.title}"`} onClick={() => setDoomed(c)} style={{ flexShrink: 0, marginRight: 4 }}><Trash2 size={14} aria-hidden /></IconButton>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog open={!!doomed} onOpenChange={(o) => { if (!o) setDoomed(null); }} title="Delete this chat?" confirmLabel="Delete chat"
        description="The conversation goes. What your model made stays, and so does its history in each pattern."
        onConfirm={async () => { const c = doomed!; await api.chats.remove(c.id); if (c.id === current || c.id === shown) setCurrentChat(null); onDeleted?.(c); }} />
    </>
  );
}

const EXAMPLES = {
  pattern: ["Write a headline about the spring sale", "Make the button orange", "Check this pattern before I knit it"],
  project: ["Make a square post about our spring sale", "Which slots in the Story pattern are locked?", "Knit the Post pattern as a PNG"],
  studio: ["List my projects", "Start a project for a coffee shop", "Which of my patterns are videos?"],
};

export function Chat({ chatId, onStarted, projectId = null, patternId, compact = false, onChanged }: {
  /** The chat shown, or null for a new one. */
  chatId: string | null;
  /** A new chat was started by its first message. */
  onStarted: (chat: ChatItem) => void;
  /** Where a new chat works: a project, or null for the whole studio. */
  projectId?: string | null;
  /** The pattern a message is about: the one open in the editor, or the one the chat is on. It offers Suggest only. */
  patternId?: string;
  compact?: boolean;
  /** A run ended, or the person undid one: the editor shows the pattern as it is now. */
  onChanged?: () => void;
}) {
  const { data: cfg } = useLive(() => api.agent.config(), []);
  const { data, setData } = useLive<ChatDetail | null>(() => (chatId ? api.chats.get(chatId) : Promise.resolve(null)), [chatId]);
  const chat = data && data.id === chatId ? data : chatId ? seeded.get(chatId) ?? null : null;
  const turns = chat?.turns ?? [];
  const last = turns.at(-1);
  const running = answering(last);
  const [text, setText] = useState("");
  const [suggest, setSuggest] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Kept at the newest message while the person is reading there; left alone once they scroll up.
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => { const b = box.current; if (b && stick.current) b.scrollTop = b.scrollHeight; }, [turns.length, last?.updatedAt]);

  useEffect(() => {
    if (!last) return;
    if (answering(last)) watched.add(last.id);
    else if (watched.delete(last.id)) onChanged?.();
  }, [last?.id, last?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // The message shows the moment it is sent, before the change stream brings the chat back with it.
  // The chat written in is the one being had, here and on the other side.
  const send = async (prompt = text.trim()) => {
    if (!prompt || sending || running) return;
    setError(undefined); setSending(true);
    const mode = patternId && suggest ? "suggest" : "edit";
    try {
      if (chatId) {
        const job = await api.chats.send(chatId, { prompt, mode, patternId });
        watched.add(job.id);
        setData((d) => (d && d.id === chatId && !d.turns.some((t) => t.id === job.id) ? { ...d, turns: [...d.turns, job] } : d));
        setCurrentChat(chatId);
      } else {
        const r = await api.chats.start({ projectId, patternId, prompt, mode });
        watched.add(r.job.id);
        seeded.set(r.chat.id, { ...r.chat, turns: [r.job] });
        onStarted(r.chat);
        setCurrentChat(r.chat.id);
      }
      setText(""); stick.current = true;
    } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  };

  if (cfg && !cfg.key.present) {
    return (
      <div style={{ display: "grid", gap: 8, padding: compact ? 0 : "var(--space-8)", alignContent: "start" }}>
        {!compact && <h2 className="h3" style={{ margin: 0 }}>Ask your model</h2>}
        <p className="body-sm prose" style={{ color: "var(--ink-muted)", margin: 0 }}>Add your own Anthropic key and your model can write copy, change layouts and knit posts for you, here, as a conversation.</p>
        <Link className="link body-sm" href="/settings?tab=model">Add a key in Settings</Link>
      </div>
    );
  }

  const examples = EXAMPLES[patternId ? "pattern" : projectId ? "project" : "studio"];
  const pad = compact ? 0 : "var(--space-8)";
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div ref={box} onScroll={() => { const b = box.current; if (b) stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 48; }}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: compact ? "var(--space-2) 0" : `var(--space-6) ${pad}` }}>
        {turns.length === 0 ? (
          <div style={{ display: "grid", gap: "var(--space-3)", maxWidth: 560 }}>
            {!compact && <Sparkles size={22} aria-hidden style={{ color: "var(--ember-ink)" }} />}
            <p className={compact ? "body-sm" : "body"} style={{ margin: 0, color: "var(--ink-muted)" }}>
              {patternId ? "It works on this pattern with you, by the same locks, and you can undo what it does." : projectId ? "It works in this project with you: copy in your brand's voice, layouts, and knits. It follows the locks you do." : "It can work in any of your projects. Name one, or ask it to start one."}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} role="group" aria-label="Things to ask">
              {examples.map((x) => <button key={x} type="button" className="chip chip-button" onClick={() => setText(x)}>{x}</button>)}
            </div>
          </div>
        ) : (
          <ol aria-label="Conversation" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: compact ? "var(--space-4)" : "var(--space-6)", maxWidth: compact ? undefined : 760 }}>
            {turns.map((t) => <Turn key={t.id} job={t} latest={t === last} compact={compact} projectId={chat?.projectId ?? null} patternId={patternId} onChanged={onChanged} />)}
          </ol>
        )}
      </div>
      <div role="status" className="sr-only">{last && !running && last.result?.text ? `Your model answered: ${last.result.text}` : running ? "Your model is working." : ""}</div>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }}
        style={{ display: "grid", gap: 8, padding: compact ? "var(--space-3) 0 0" : `var(--space-4) ${pad} var(--space-6)`, borderTop: "1px solid var(--line)" }}>
        <div style={{ display: "grid", gap: 8, maxWidth: compact ? undefined : 760 }}>
          <Textarea aria-label="Message your model" rows={compact ? 3 : 2} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
            placeholder={turns.length ? "Reply, or ask for something else" : examples[0]} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            {patternId
              ? <label className="body-sm" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} /> Suggest only (works on a copy)</label>
              : <span className="body-sm" style={{ color: "var(--ink-muted)" }}>Enter sends. Shift+Enter starts a new line.</span>}
            <div style={{ display: "flex", gap: 8 }}>
              {running && last && <Button onClick={() => void api.agent.cancel(last.id).catch((e) => setError((e as Error).message))}><X size={14} aria-hidden /> Stop</Button>}
              <Button variant="primary" type="submit" disabled={running || sending || !text.trim()}><Sparkles size={14} aria-hidden /> {sending ? "Sending..." : "Send"}</Button>
            </div>
          </div>
          {error && <p className="field-error" role="alert" style={{ margin: 0 }}><AlertTriangle size={13} aria-hidden /> {error}</p>}
        </div>
      </form>
    </div>
  );
}

/** One message and its answer: what was asked, the steps taken, what changed, and, on the newest, Keep or Undo all. */
function Turn({ job, latest, compact, projectId, patternId, onChanged }: { job: AgentJob; latest: boolean; compact: boolean; projectId: string | null; patternId?: string; onChanged?: () => void }) {
  const toast = useToast();
  const [settled, setSettled] = useState<"kept" | "undone" | null>(null);
  const [error, setError] = useState<string | undefined>();
  const r = job.result;
  const running = answering(job);
  const events = job.progress?.events ?? [];
  const steps = stepsOf(events, r?.text);
  const tools = steps.filter((s) => s.kind === "tool").length;
  const stops = events.filter((e): e is Extract<AgentEvent, { type: "stopped" }> => e.type === "stopped");
  const changed = (r?.changed ?? []).filter((c) => c.patternId !== r?.suggestion);
  const undoable = changed.filter((c) => c.baselineRevisionId && c.count > 0);
  const now = [...steps].reverse().find((s) => s.state === "running");

  const undo = async () => {
    try {
      for (const c of undoable) await api.patterns.restore(c.patternId, c.baselineRevisionId!);
      setSettled("undone"); toast("Put back the way it was."); onChanged?.();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <li style={{ display: "grid", gap: "var(--space-3)" }}>
      <div style={{ justifySelf: compact ? "stretch" : "end", maxWidth: compact ? undefined : "80%", background: "var(--surface-sunken)", borderRadius: "var(--radius-md)", padding: "8px 12px" }}>
        <p className={compact ? "body-sm" : "body"} style={{ margin: 0, whiteSpace: "pre-wrap" }}>{job.input?.prompt}</p>
      </div>
      <div style={{ display: "grid", gap: 8 }} aria-busy={running}>
        <p className="eyebrow" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}><Sparkles size={12} aria-hidden /> Your model</p>
        {r?.text && <p className={compact ? "body-sm" : "body"} style={{ margin: 0, whiteSpace: "pre-wrap" }}>{r.text}</p>}
        {running && (
          <p className="body-sm" style={{ margin: 0, display: "flex", gap: 8, alignItems: "center", color: "var(--ink-muted)" }}>
            <span aria-hidden className="working" style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }} />
            {now ? `Working: ${now.text}` : "Thinking..."}
          </p>
        )}
        {steps.length > 0 && (
          <details open={running || undefined}>
            <summary className="body-sm" style={{ cursor: "pointer", color: "var(--ink-muted)" }}>What it did{tools ? ` (${tools} step${tools === 1 ? "" : "s"})` : ""}</summary>
            <ol style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 4 }} className="body-sm">
              {steps.map((s, i) => (
                <li key={i} style={{ color: s.kind === "refused" || s.state === "failed" ? "var(--danger)" : s.kind === "say" ? "var(--ink-muted)" : undefined, whiteSpace: s.kind === "say" ? "pre-wrap" : undefined }}>
                  {s.kind === "tool" && s.state === "done" && <><Check size={12} aria-hidden style={{ marginRight: 4, verticalAlign: "-1px", color: "var(--success)" }} /><span className="sr-only">Done: </span></>}
                  {s.text}
                </li>
              ))}
            </ol>
          </details>
        )}
        {stops.map((s, i) => <p key={i} className="body-sm" style={{ margin: 0, color: "var(--ember-ink)" }}>{s.why}</p>)}
        {r && r.refusals.length > 0 && <p className="body-sm" style={{ margin: 0 }}>{r.refusals.length} change{r.refusals.length === 1 ? " was" : "s were"} refused because of locks.</p>}
        {r && (changed.length > 0 || r.suggestion || (r.knitIn ?? []).length > 0) && (
          <div className="card" style={{ padding: "var(--space-3)", display: "grid", gap: 6 }}>
            {r.suggestion && projectId && <Link className="link body-sm" href={`/projects/${projectId}/patterns/${r.suggestion}`}>Open the suggestion</Link>}
            {changed.map((c) => (
              <p key={c.patternId} className="body-sm" style={{ margin: 0 }}>
                {c.made ? "Made " : "Changed "}
                {compact && c.patternId === patternId ? "this pattern" : <Link className="link" href={`/projects/${c.projectId}/patterns/${c.patternId}`}>{c.name}</Link>}
                {!c.made && c.count > 0 ? `, ${c.count} change${c.count === 1 ? "" : "s"}` : ""}
              </p>
            ))}
            {(r.knitIn ?? []).map((pid) => <Link key={pid} className="link body-sm" href={`/projects/${pid}/knits`}>See what it knitted</Link>)}
            {latest && !running && undoable.length > 0 && (settled ? (
              <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{settled === "kept" ? "Kept." : "Put back the way it was."}</p>
            ) : (
              <>
                {changed.some((c) => c.made) && <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Undo all puts back what it changed. What it made stays.</p>}
                <div style={{ display: "flex", gap: 8 }}>
                  <Button size="sm" onClick={() => setSettled("kept")}>Keep</Button>
                  <Button size="sm" variant="danger" onClick={undo}>Undo all</Button>
                </div>
              </>
            ))}
          </div>
        )}
        {job.status === "done" && !r?.text && !changed.length && !stops.length && <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Done.</p>}
        {(job.status === "failed" || job.status === "interrupted") && <p className="field-error" role="alert" style={{ margin: 0 }}><AlertTriangle size={13} aria-hidden /> {job.error}</p>}
        {job.status === "cancelled" && <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Stopped.</p>}
        {error && <p className="field-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      </div>
    </li>
  );
}
