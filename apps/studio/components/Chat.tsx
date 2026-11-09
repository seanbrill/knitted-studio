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
import { api, type AgentEvent, type AgentJob, type ChatDetail, type ChatItem, type JobItem } from "@knitted/core/client";
import { Button, ConfirmDialog, IconButton, Markdown, Textarea, icons, useToast } from "@knitted/ui";
import { showingChat, useAgent } from "@/lib/agent";
import { setCurrentChat, useCurrentChat } from "@/lib/current-chat";
import { timeAgo, useLive } from "@/lib/hooks";
import { currentChoice, modelName } from "@/lib/model-choice";
import { knitShare } from "./KnitQueue";
import { ModelPicker } from "./ModelPicker";

const { AlertTriangle, Check, Sparkles, Trash2, X } = icons;

// Messages sent while the model is still answering wait their turn, each chat its own line,
// kept on this computer so a reload or going to the editor does not lose them. Each goes when
// the one before is answered; a run that was stopped or failed holds the rest for the person.
const queues = new Map<string, string[]>();
const QUEUE = (id: string) => `knitted.chat.queue.${id}`;
function queueOf(id: string): string[] {
  if (!queues.has(id)) { try { queues.set(id, JSON.parse(localStorage.getItem(QUEUE(id)) ?? "[]")); } catch { queues.set(id, []); } }
  return queues.get(id)!;
}

const answering = (j?: AgentJob | null) => !!j && (j.status === "queued" || j.status === "running");
const words = (tool: string) => tool.replace(/_/g, " ");

// The runs sent or seen answering from this window. When one ends, whatever shows its work
// reloads. Kept outside the component, as the first message of a chat remounts it.
const watched = new Set<string>();
// A chat just started, as its start answered: shown at once, while the chat itself loads.
const seeded = new Map<string, ChatDetail>();

type Step = { kind: "say" | "tool" | "refused" | "model"; text: string; state?: "running" | "done" | "failed"; tool?: string; input?: Record<string, unknown>; detail?: string };
// A step's words once it is done: "Filling headline on Story" becomes "Filled headline on Story".
const DONE: Record<string, string> = { Adding: "Added", Animating: "Animated", Answering: "Answered", Arranging: "Arranged", Bringing: "Brought", Changing: "Changed", Checking: "Checked", Choosing: "Chose", Copying: "Copied", Cutting: "Cut", Designing: "Designed", Drawing: "Drew", Editing: "Edited", Filing: "Filed", Filling: "Filled", Knitting: "Knitted", Looking: "Looked", Making: "Made", Marking: "Marked", Moving: "Moved", Opening: "Opened", Pricing: "Priced", Proposing: "Proposed", Reading: "Read", Recording: "Recorded", Removing: "Removed", Renaming: "Renamed", Saving: "Saved", Searching: "Searched", Starting: "Started", Stopping: "Stopped", Tagging: "Tagged", Taking: "Took", Writing: "Wrote" };
const doneWords = (say: string) => say.replace(/^[A-Z][a-z]+/, (w) => DONE[w] ?? w);
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/**
 * What a run did, a line a step: what the model said along the way, each tool in words and how
 * it went, what a lock refused. A run from before steps had words names its tools.
 */
function stepsOf(events: AgentEvent[], answer?: string): Step[] {
  const out: Step[] = [];
  for (const e of events) {
    if (e.type === "text" || e.type === "note") { if (e.text !== answer) out.push({ kind: "say", text: e.text }); }
    else if (e.type === "tool_call") out.push({ kind: "tool", tool: e.name, text: e.say ?? sentence(words(e.name)), input: (e.input ?? {}) as Record<string, unknown>, state: "running" });
    else if (e.type === "tool_result") {
      const t = [...out].reverse().find((s) => s.kind === "tool" && s.state === "running" && s.tool === e.name);
      if (!t) continue;
      t.state = e.summary.startsWith("failed") ? "failed" : "done";
      if (t.state === "failed") t.detail = e.summary.replace(/^failed: /, "");
      else {
        t.text = doneWords(t.text);
        const held = /^(\d+) refused$/.exec(e.summary);
        if (held) t.detail = `${held[1]} ${held[1] === "1" ? "change" : "changes"} held back by a lock`;
      }
    }
    else if (e.type === "refusal") out.push({ kind: "refused", text: `Could not change ${e.slot}: ${e.why}` });
    // Which model, when Auto picked it or it changed part way.
    else if (e.type === "model" && (e.why || e.switched)) out.push({ kind: "model", text: e.switched ? `Switched to ${e.name}: ${e.why ?? "you picked it"}` : `${e.name}, ${e.why}` });
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
      {chats.length === 0 && <p className="body-sm" style={{ margin: 0, padding: "var(--space-2)", color: "var(--ink-muted)" }}>Your conversations show here.</p>}
      {/* A list for each day: today, yesterday, this week, before. */}
      {byDay(chats).map((g) => (
        <div key={g.label} style={{ display: "grid", gap: 2, marginBottom: "var(--space-3)" }}>
          <p className="eyebrow" style={{ margin: 0, padding: "4px 10px" }}>{g.label}</p>
          <ul aria-label={`Chats, ${g.label.toLowerCase()}`} style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", alignContent: "start", gap: 2 }}>
            {g.chats.map((c) => {
              const on = c.id === shown;
              const what = (<>
                <span className="label" style={oneLine}>{c.title}</span>
                <span className="body-sm" style={{ color: "var(--ink-muted)", ...oneLine }}>{c.running ? "Answering..." : timeAgo(c.updatedAt)}, {placeOf(c)}</span>
              </>);
              return (
                <li key={c.id} className="chat-li" data-on={on || undefined} style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: "var(--radius-md)", background: on ? "var(--tint)" : undefined }}>
                  {href ? <Link href={href(c)} aria-current={on ? "page" : undefined} style={look}>{what}</Link>
                    : <button type="button" aria-current={on || undefined} onClick={() => onOpen?.(c)} style={{ ...look, background: "transparent", border: 0, borderRadius: "var(--radius-md)", textAlign: "left", font: "inherit", cursor: "pointer" }}>{what}</button>}
                  <IconButton label={`Delete the chat "${c.title}"`} onClick={() => setDoomed(c)} className="chat-del" style={{ flexShrink: 0, marginRight: 4 }}><Trash2 size={14} aria-hidden /></IconButton>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <ConfirmDialog open={!!doomed} onOpenChange={(o) => { if (!o) setDoomed(null); }} title="Delete this chat?" confirmLabel="Delete chat"
        description="The conversation goes. What your model made stays, and so does its history in each pattern."
        onConfirm={async () => { const c = doomed!; await api.chats.remove(c.id); if (c.id === current || c.id === shown) setCurrentChat(null); onDeleted?.(c); }} />
    </>
  );
}

/** Chats, newest first, in groups by the day they were last had. */
function byDay(chats: ChatItem[], now = new Date()): { label: string; chats: ChatItem[] }[] {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = midnight(now);
  const groups: { label: string; chats: ChatItem[] }[] = [];
  for (const c of chats) {
    const days = Math.round((today - midnight(new Date(c.updatedAt))) / 86_400_000);
    const label = days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "This week" : "Before";
    const last = groups[groups.length - 1];
    if (last?.label === label) last.chats.push(c); else groups.push({ label, chats: [c] });
  }
  return groups;
}

const EXAMPLES = {
  pattern: ["Write a headline about the spring sale", "Make the button orange", "Check this pattern before I knit it"],
  project: ["Make a square post about our spring sale", "Which slots in the Story pattern are locked?", "Knit the Post pattern as a PNG"],
  studio: ["List my projects", "Start a project for a coffee shop", "Which of my patterns are videos?"],
};

/** A limit said no: a way straight to where it is raised. */
const spendingLink = (why: string | null | undefined) => why && /Settings, Spending/.test(why) ? <> <Link className="link" href="/settings?tab=spending">Open Spending</Link></> : null;

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
  const [queued, setQueued] = useState<string[]>([]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setQueued(chatId ? queueOf(chatId) : []); }, [chatId]);
  // On screen, a run that ends here is seen ending, and is not announced as well (ModelDone).
  useEffect(() => (chatId ? showingChat(chatId) : undefined), [chatId]);
  const keep = (q: string[]) => { if (!chatId) return; queues.set(chatId, q); try { localStorage.setItem(QUEUE(chatId), JSON.stringify(q)); } catch { /* still kept for this visit */ } setQueued(q); };

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
  const send = async (prompt = text.trim(), next = false) => {
    if (!prompt) return;
    // Busy: it waits its turn (a new chat's first message is quick, and then there is a chat to queue in).
    if ((sending || running) && !next) { if (chatId) { keep([...queued, prompt]); setText(""); stick.current = true; } return; }
    setError(undefined); setSending(true);
    const mode = patternId && suggest ? "suggest" : "edit";
    try {
      if (chatId) {
        const job = await api.chats.send(chatId, { prompt, mode, patternId, model: currentChoice() });
        watched.add(job.id);
        setData((d) => (d && d.id === chatId && !d.turns.some((t) => t.id === job.id) ? { ...d, turns: [...d.turns, job] } : d));
        setCurrentChat(chatId);
      } else {
        const r = await api.chats.start({ projectId, patternId, prompt, mode, model: currentChoice() });
        watched.add(r.job.id);
        seeded.set(r.chat.id, { ...r.chat, turns: [r.job] });
        onStarted(r.chat);
        setCurrentChat(r.chat.id);
      }
      if (!next) setText(""); // what the person is typing now is theirs, not the queue's
      stick.current = true;
    } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  };
  const sendNext = () => { const [n, ...rest] = queued; if (!n) return; keep(rest); void send(n, true); };
  // The answer is in: the next message goes. Stopped or failed, the rest wait for the person.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!running && !sending && queued.length && last?.status === "done") sendNext();
  }, [running, sending, last?.status, queued.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const noKey = !!cfg && !cfg.key.present;
  if (noKey && !chatId) {
    // No key, and no chat open: what asking is like, and the two ways in. A chat had before stays readable (below).
    const asks = EXAMPLES[patternId ? "pattern" : projectId ? "project" : "studio"];
    return (
      <div className="arrive" style={{ display: "grid", gap: compact ? 8 : "var(--space-4)", padding: compact ? 0 : "var(--space-8)", alignContent: "start", maxWidth: 620 }}>
        {!compact && <h2 className="h3" style={{ margin: 0 }}>Ask your model</h2>}
        <p className="body-sm prose" style={{ color: "var(--ink-muted)", margin: 0 }}>Add your own Anthropic key and your model can write copy, change layouts and knit posts for you, here, as a conversation.</p>
        {compact ? <Link className="link body-sm" href="/settings?tab=model">Add a key in Settings</Link> : <>
          <div><Link className="btn btn-primary" href="/settings?tab=model">Add a key in Settings</Link></div>
          <div style={{ display: "grid", gap: 6 }}>
            <p className="eyebrow" style={{ margin: 0 }}>What you could ask</p>
            <ul aria-label="What you could ask" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {asks.map((a) => <li key={a} className="body-sm" style={{ padding: "8px 12px", borderRadius: "var(--radius-md)", border: "1px dashed var(--line-strong)", color: "var(--ink-muted)" }}>{a}</li>)}
            </ul>
          </div>
          <p className="body-sm prose" style={{ color: "var(--ink-muted)", margin: 0 }}>Or use Claude Code with your own plan: connect it once and it works in this studio from your terminal, with the same tools and the same locks. <Link className="link" href="/settings?tab=model">Connect Claude Code</Link></p>
        </>}
      </div>
    );
  }

  const examples = EXAMPLES[patternId ? "pattern" : projectId ? "project" : "studio"];
  const pad = compact ? 0 : "var(--space-8)";
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div ref={box} onScroll={() => { const b = box.current; if (b) stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 48; }}
        // Positioned, so the hidden words in it ("You:", "Done:") are held in its scroll, not stretching the page.
        style={{ flex: 1, minHeight: 0, overflowY: "auto", position: "relative", padding: compact ? "var(--space-2) 0" : `var(--space-6) ${pad}` }}>
        {turns.length === 0 ? (noKey ? null : (
          <div style={{ display: "grid", gap: "var(--space-3)", maxWidth: 560 }}>
            {!compact && <Sparkles size={22} aria-hidden style={{ color: "var(--ember-ink)" }} />}
            <p className={compact ? "body-sm" : "body"} style={{ margin: 0, color: "var(--ink-muted)" }}>
              {patternId ? "It works on this pattern with you, by the same locks, and you can undo what it does." : projectId ? "It works in this project with you: copy in your brand's voice, layouts, and knits. It follows the locks you do." : "It can work in any of your projects. Name one, or ask it to start one."}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} role="group" aria-label="Things to ask">
              {examples.map((x) => <button key={x} type="button" className="chip chip-button" onClick={() => setText(x)}>{x}</button>)}
            </div>
          </div>
        )) : (
          <ol aria-label="Conversation" className="chat" data-compact={compact || undefined} style={{ maxWidth: compact ? undefined : 760 }}>
            {turns.map((t) => <Turn key={t.id} job={t} latest={t === last} compact={compact} projectId={chat?.projectId ?? null} patternId={patternId} onChanged={onChanged} />)}
          </ol>
        )}
      </div>
      {queued.length > 0 && (
        <div style={{ display: "grid", gap: 6, padding: compact ? "var(--space-2) 0 0" : `var(--space-3) ${pad} 0`, maxWidth: compact ? undefined : 760 }}>
          <ol aria-label="Waiting to send" className="chat-queue">
            {queued.map((q, i) => (
              <li key={`${i}-${q.slice(0, 20)}`}>
                <span className="eyebrow">{i === 0 ? "Next" : `${i + 1}th`.replace(/^2th/, "2nd").replace(/^3th/, "3rd")}</span>
                <span className="chat-queue-text">{q}</span>
                <IconButton label={`Take "${q.slice(0, 40)}" out of the queue`} onClick={() => keep(queued.filter((_, k) => k !== i))}><X size={13} aria-hidden /></IconButton>
              </li>
            ))}
          </ol>
          {last && !running && !sending && last.status !== "done" && (
            <p className="body-sm" style={{ margin: 0, display: "flex", gap: 8, alignItems: "center", color: "var(--ink-muted)" }}>
              {last.status === "cancelled" ? "You stopped it, so these are waiting for you." : "The last one did not finish, so these are waiting for you."}
              <Button size="sm" onClick={sendNext}>Send the next one</Button>
            </p>
          )}
        </div>
      )}
      <div role="status" className="sr-only">{last && !running && last.result?.text ? `Your model answered: ${last.result.text}` : running ? "Your model is working." : ""}</div>
      {noKey ? (
        // A chat had before is kept and read without a key; writing in it again needs one.
        <div role="note" aria-label="Writing needs a key" className="chat-nokey" style={{ padding: compact ? "var(--space-3) 0 0" : `var(--space-4) ${pad} var(--space-6)` }}>
          <div style={{ display: "grid", gap: 8, maxWidth: compact ? undefined : 760 }}>
            <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>To write in this chat again, add your Anthropic key. Or connect Claude Code once, and it works in this studio from your terminal with your own plan.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link className={compact ? "link body-sm" : "btn btn-primary"} href="/settings?tab=model">Add a key in Settings</Link>
            </div>
          </div>
        </div>
      ) : (
      <form onSubmit={(e) => { e.preventDefault(); void send(); }}
        style={{ display: "grid", gap: 8, padding: compact ? "var(--space-3) 0 0" : `var(--space-4) ${pad} var(--space-6)`, borderTop: "1px solid var(--line)" }}>
        <div style={{ display: "grid", gap: 8, maxWidth: compact ? undefined : 760 }}>
          <Textarea aria-label="Message your model" rows={compact ? 3 : 2} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
            placeholder={turns.length ? "Reply, or ask for something else" : examples[0]} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            {patternId
              ? <label className="body-sm" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} /> Suggest only (works on a copy)</label>
              : <span className="body-sm" style={{ color: "var(--ink-muted)" }}>{running ? "Enter adds it to the queue: it goes when this answer is done." : "Enter sends. Shift+Enter starts a new line."}</span>}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <ModelPicker />
              {running && last && <Button onClick={() => void api.agent.cancel(last.id).catch((e) => setError((e as Error).message))}><X size={14} aria-hidden /> Stop</Button>}
              <Button variant="primary" type="submit" disabled={!text.trim() || (sending && !chatId)}><Sparkles size={14} aria-hidden /> {running || sending ? "Queue it" : "Send"}</Button>
            </div>
          </div>
          {error && <p className="field-error" role="alert" style={{ margin: 0 }}><AlertTriangle size={13} aria-hidden /> {error}</p>}
        </div>
      </form>
      )}
    </div>
  );
}

/**
 * How far the knit a step waits on has got, as the knit queue shows it: the one this pattern
 * is knitting, or the job it checks on. Looked at again while the step runs.
 */
function StepProgress({ step }: { step: Step }) {
  const [job, setJob] = useState<JobItem | null>(null);
  const patternId = typeof step.input?.patternId === "string" ? step.input.patternId : undefined;
  const jobId = typeof step.input?.jobId === "string" ? step.input.jobId : undefined;
  useEffect(() => {
    let live = true;
    const look = async () => {
      const j = jobId ? await api.knit.job(jobId).catch(() => null)
        : (await api.knit.active().catch(() => [] as JobItem[])).find((x) => x.status === "running" && (!patternId || x.input?.patternId === patternId)) ?? null;
      if (live) setJob(j);
    };
    void look();
    const t = setInterval(() => void look(), 700);
    return () => { live = false; clearInterval(t); };
  }, [jobId, patternId]);
  const p = job?.progress;
  if (!job || !p?.total) return null;
  const pct = Math.round(knitShare(job) * 100);
  const of = p.total > 1 ? `File ${Math.min(p.total, p.done + 1)} of ${p.total}` : null;
  const frames = p.frames?.total ? `frame ${p.frames.done} of ${p.frames.total}` : null;
  return (
    <>
      <span className="chat-step-detail">{[of, p.step, frames].filter(Boolean).join(" · ") || `${pct}%`}</span>
      <span className="knit-bar chat-step-bar" role="progressbar" aria-label={step.text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></span>
    </>
  );
}

/** What the model is writing as it writes it: its notes as it thinks, then its answer, until the answer is in. */
function LiveWords({ jobId }: { jobId: string }) {
  const live = useAgent()?.live?.find((l) => l.jobId === jobId);
  // A note once finished is a line in What it did, under this: shown here too, it would be there twice.
  if (!live?.text || (live.kind === "note" && live.done)) return null;
  // Long, it starts at a word: what came before went by already.
  const cut = live.text.length >= 600;
  const text = cut ? live.text.slice(live.text.search(/\s/) + 1) : live.text;
  return <div className="chat-live" data-kind={live.kind} data-cut={cut || undefined}><Markdown text={text} className={live.kind === "note" ? "chat-note" : "chat-answer"} /></div>;
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
  // The models it was on: from the answer once in, from what it did while it runs.
  const used = r?.models ?? [...new Set(events.flatMap((e) => (e.type === "model" ? [e.model] : [])))];

  const undo = async () => {
    try {
      for (const c of undoable) await api.patterns.restore(c.patternId, c.baselineRevisionId!);
      setSettled("undone"); toast("Put back the way it was."); onChanged?.();
    } catch (e) { setError((e as Error).message); }
  };

  // The person's words on the right, in a box; the model's on the left, under its name, formatted.
  return (
    <li className="chat-turn">
      <div className="chat-you">
        <p className="chat-you-text"><span className="sr-only">You: </span>{job.input?.prompt}</p>
      </div>
      <div className="chat-model" aria-busy={running}>
        <p className="eyebrow chat-model-name"><Sparkles size={12} aria-hidden /> Your model{used.length > 0 && <span className="chat-model-which">{used.map(modelName).join(", then ")}</span>}</p>
        {r?.text && <Markdown text={r.text} className="chat-answer" />}
        {running && <LiveWords jobId={job.id} />}
        {running && (
          <p className="chat-working">
            <span aria-hidden className="working" style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }} />
            {now ? `${now.text}...` : "Thinking..."}
          </p>
        )}
        {steps.length > 0 && (
          <details open={running || undefined} className="chat-steps" data-running={running || undefined}>
            <summary>What it did{tools ? ` (${tools} step${tools === 1 ? "" : "s"})` : ""}</summary>
            <ol>
              {steps.map((s, i) => (
                <li key={i} data-kind={s.kind} data-state={s.state}>
                  <span className="chat-step-mark" aria-hidden>
                    {s.kind === "tool" ? (s.state === "done" ? <Check size={12} /> : s.state === "failed" ? <AlertTriangle size={12} /> : <span className="working" />) : s.kind === "refused" ? <X size={12} /> : null}
                  </span>
                  {s.kind === "tool" && <span className="sr-only">{s.state === "done" ? "Done: " : s.state === "failed" ? "Failed: " : "Working: "}</span>}
                  {s.kind === "say" ? <Markdown text={s.text} className="chat-note" /> : (
                    <span className="chat-step-body">
                      <span>{s.text}</span>
                      {s.detail && <span className="chat-step-detail">{s.detail}</span>}
                      {running && s.state === "running" && (s.tool === "knit_pattern" || s.tool === "get_job") && <StepProgress step={s} />}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </details>
        )}
        {stops.map((s, i) => <p key={i} className="body-sm" style={{ margin: 0, color: "var(--ember-ink)" }}>{s.why}{spendingLink(s.why)}</p>)}
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
        {(job.status === "failed" || job.status === "interrupted") && <p className="field-error" role="alert" style={{ margin: 0 }}><AlertTriangle size={13} aria-hidden /> {job.error}{spendingLink(job.error)}</p>}
        {job.status === "cancelled" && <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Stopped.</p>}
        {error && <p className="field-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      </div>
    </li>
  );
}
