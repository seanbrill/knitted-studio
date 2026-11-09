"use client";

// Comments pinned to a spot on a knit (and a moment, in a video) or on a frame of a design
// sheet: the pins over the picture, and the threads where the person writes, replies and
// resolves them, or asks their model to do what one says. The model reads the same threads
// with list_comments and view_comment, and answers with reply_comment.

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { CommentThread } from "@knitted/core";
import { api, type KnitRecord } from "@knitted/core/client";
import { Button, ConfirmDialog, IconButton, Textarea, icons, useToast } from "@knitted/ui";
import { timeAgo, useLive } from "@/lib/hooks";
import { currentChoice } from "@/lib/model-choice";

const { Check, MessageSquare, RotateCcw, Sparkles, Trash2 } = icons;

/** Where a new comment goes. No x and y: on the whole thing (or, in a video, on a moment). */
export interface Draft { x?: number; y?: number; timeMs?: number; frameId?: string; frameName?: string }

/** What the comments are on, as the model is told it. */
export type CommentsOn =
  | { kind: "knit"; projectId: string; knitId: string; label: string; patternId: string | null; video: boolean }
  | { kind: "design"; projectId: string; designId: string; name: string };

export const clock = (ms: number) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, "0")}`;
const who = (a: string) => (a === "human" ? "You" : "Your model");
const placed = (t: { x?: number | null; timeMs?: number | null; frameName?: string | null }, whole: string) => {
  const parts = [t.frameName, t.timeMs != null ? `at ${clock(t.timeMs)}` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : t.x != null ? "pinned" : `on the whole ${whole}`;
};

export function useComments(on: CommentsOn) {
  const key = on.kind === "knit" ? on.knitId : on.designId;
  const { data, refresh } = useLive(() => api.comments.list(on.kind === "knit" ? { knit: on.knitId } : { design: on.designId }), [key]);
  return { threads: data ?? [], refresh };
}

/** What a thread list and its pins share: the comment being placed, the one picked, and what shows. */
export function useCommentState() {
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  return { picking, setPicking, draft, setDraft, active, setActive, showResolved, setShowResolved };
}
export type CommentState = ReturnType<typeof useCommentState>;

/** The threads that show: the open ones, and the resolved ones too when asked. */
export const shownThreads = (threads: CommentThread[], c: CommentState) => threads.filter((t) => c.showResolved || !t.resolvedAt || t.id === c.active);

/** What the model is asked, to do what comments say. */
export function fixPrompt(on: CommentsOn, threads: CommentThread[]): string {
  const what = on.kind === "knit" ? `the knit "${on.label}" (${on.knitId})` : `the design sheet "${on.name}" (${on.designId})`;
  const how = on.kind === "knit"
    ? on.patternId
      ? `A knit is a finished file: change the pattern it was knitted from (${on.patternId}), check it with check_pattern, and knit it again with knit_pattern at the same size and format. That makes the next version of this knit, shown in its place, and the old one stays under its Versions.`
      : "The pattern it was knitted from is gone: make the change in the closest pattern and knit a new version."
    : "Read get_guide designing first. Change the frame with set_design_frame, and look again with view_design.";
  const list = threads.map((t) => `comment ${t.n} (${t.id})${t.frameName ? ` on the frame ${t.frameName}` : ""}${t.timeMs != null ? ` at ${clock(t.timeMs)}` : ""}: "${t.text}"`).join("; ");
  return `The person left ${threads.length === 1 ? "a comment" : `${threads.length} comments`} on ${what}, each pinned to the part that should change. Look at each with view_comment first: it shows the spot and says what is under the pin. ${how} When one is done, answer it with reply_comment, saying what you changed, with resolve: true. If one is not clear, ask in a reply instead, and leave it open.\n\nWhat I want: ${list}`;
}

function useAskToFix(on: CommentsOn) {
  const toast = useToast();
  const router = useRouter();
  return async (threads: CommentThread[]) => {
    if (!threads.length) return;
    try {
      const { chat } = await api.chats.start({ projectId: on.projectId, patternId: on.kind === "knit" ? on.patternId ?? undefined : undefined, prompt: fixPrompt(on, threads), model: currentChoice() });
      toast(`Your model is on it: ${threads.length === 1 ? `comment ${threads[0]!.n}` : `${threads.length} comments`}`, { label: "Open the chat", onClick: () => router.push(`/ask?chat=${chat.id}`) }, 10_000);
    } catch (e) { toast.problem((e as Error).message); }
  };
}

/** The pins over a picture or a frame, numbered, and the one being placed. */
export function Pins({ threads, draft, active, onPick, at }: { threads: CommentThread[]; draft?: Draft | null; active?: string | null; onPick: (t: CommentThread) => void; at?: number }) {
  // In a video, a pin shows about its moment.
  const near = (t: CommentThread) => at == null || t.timeMs == null || Math.abs(t.timeMs - at) <= 1500 || t.id === active;
  return <>
    {threads.filter((t) => t.x != null && t.y != null && near(t)).map((t) => (
      <button key={t.id} type="button" className="pin" data-pan-ok data-active={t.id === active || undefined} data-resolved={t.resolvedAt ? true : undefined}
        style={{ left: `${t.x! * 100}%`, top: `${t.y! * 100}%` }} aria-label={`Comment ${t.n}${t.resolvedAt ? ", resolved" : ""}: ${t.text}`}
        onClick={(e) => { e.stopPropagation(); onPick(t); }}>{t.n}</button>
    ))}
    {draft?.x != null && draft.y != null && <span className="pin" data-draft style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }} aria-hidden><MessageSquare size={12} /></span>}
  </>;
}

/** Over the picture while a comment is placed: a click there says where it goes. */
export function PinCatch({ label, onSpot }: { label: string; onSpot: (x: number, y: number) => void }) {
  return <button type="button" className="pin-catch" data-pan-ok aria-label={label} onClick={(e) => {
    e.stopPropagation();
    // Measured on what it covers, the picture or the frame: in a video it stops short of the controls.
    const r = (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect();
    // From the keyboard there is no pointer: the middle.
    const key = e.detail === 0 || !r.width || !r.height;
    const f = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10_000) / 10_000;
    onSpot(key ? 0.5 : f((e.clientX - r.left) / r.width), key ? 0.5 : f((e.clientY - r.top) / r.height));
  }} />;
}

/**
 * The threads: a new one being written, then each with its replies and what can be done with it.
 * `wholeWords` names the whole thing for a comment with no pin: "knit", "video" or "sheet".
 */
export function CommentThreads({ on, threads, c, refresh, wholeWords, hint, onGo, moment, heading = true }: {
  on: CommentsOn; threads: CommentThread[]; c: CommentState; refresh: () => unknown; wholeWords: string;
  /** Its own "Comments" heading; off where the panel round it has one. */
  heading?: boolean;
  /** What to do while placing a pin. */
  hint: ReactNode;
  /** Shows a thread's spot: seeks the video, or brings its frame into view. */
  onGo?: (t: CommentThread) => void;
  /** In a video: the moment now, for a comment on a moment without a spot. */
  moment?: () => number;
}) {
  const toast = useToast();
  const ask = useAskToFix(on);
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CommentThread | null>(null);
  const busy = useRef(false);
  const open = threads.filter((t) => !t.resolvedAt);
  const resolved = threads.length - open.length;
  const shown = shownThreads(threads, c);
  const next = threads.length ? Math.max(...threads.map((t) => t.n)) + 1 : 1;

  const start = (d: Draft) => { c.setDraft(d); c.setActive(null); setErr(null); };
  const cancel = () => { c.setDraft(null); c.setPicking(false); setText(""); setErr(null); };
  const add = async () => {
    const said = text.trim();
    if (!said) { setErr("Write the comment first."); return; }
    if (!c.draft || busy.current) return;
    busy.current = true;
    try {
      const { frameName: _, ...spot } = c.draft;
      const t = await api.comments.add({ ...(on.kind === "knit" ? { knitId: on.knitId } : { designId: on.designId }), ...spot, text: said });
      setText(""); c.setDraft(null); c.setPicking(false); c.setActive(t.id);
      await refresh();
    } catch (e) { setErr((e as Error).message); }
    finally { busy.current = false; }
  };
  const act = async (p: Promise<unknown>, said?: string) => { try { await p; await refresh(); if (said) toast(said); } catch (e) { toast.problem((e as Error).message); } };
  const pick = (t: CommentThread) => { c.setActive(t.id === c.active ? null : t.id); setReply(""); if (t.id !== c.active) onGo?.(t); };

  return (
    <section className="comments" aria-label="Comments">
      <div className="comments-head">
        {heading && <h3 className="label" style={{ margin: 0 }}>Comments</h3>}
        <span className="body-sm" style={{ color: "var(--ink-muted)" }}>{open.length ? `${open.length} open` : threads.length ? "All resolved" : "None yet"}</span>
        <span style={{ flex: 1 }} />
        {resolved > 0 && <button type="button" className="chip chip-button" aria-pressed={c.showResolved} onClick={() => c.setShowResolved(!c.showResolved)}>Resolved ({resolved})</button>}
        {/* No tooltip: in a knit's window this can be the first thing focused, and an open tooltip takes the Escape that shuts the window. */}
        <Button size="sm" aria-pressed={c.picking} onClick={() => (c.picking ? cancel() : (c.setPicking(true), c.setActive(null)))}>
          <MessageSquare size={14} aria-hidden /> {c.picking ? "Stop commenting" : "Add a comment"}
        </Button>
      </div>

      {c.picking && !c.draft && (
        <p className="body-sm comments-hint">{hint}{" "}Or comment on{" "}
          {moment && <><button type="button" className="link" onClick={() => start({ timeMs: Math.round(moment()) })}>this moment</button>{" or "}</>}
          <button type="button" className="link" onClick={() => start({})}>the whole {wholeWords}</button>.
        </p>
      )}
      {c.draft && (
        <form className="comment" data-active onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <div className="comment-meta"><span className="comment-n">{next}</span><b>New comment</b><span>{placed(c.draft, wholeWords)}</span></div>
          <Textarea aria-label={`Comment ${next}`} autoFocus rows={3} value={text} placeholder="What should change here?" onChange={(e) => { setText(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void add(); } if (e.key === "Escape") { e.stopPropagation(); cancel(); } }} />
          {err && <p className="field-error" role="alert" style={{ margin: 0 }}>{err}</p>}
          <div className="comment-actions"><span style={{ flex: 1 }} /><Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button><Button size="sm" variant="primary" type="submit">Add the comment</Button></div>
        </form>
      )}

      {open.length > 0 && !c.draft && !(open.length === 1 && open[0]!.id === c.active) && (
        <Button size="sm" tip="Your model looks at each spot, makes the change, and answers each comment." onClick={() => void ask(open)}>
          <Sparkles size={14} aria-hidden /> {open.length === 1 ? "Ask your model to do it" : `Ask your model to do all ${open.length}`}
        </Button>
      )}

      {shown.length > 0 && <ol className="comment-list">
        {shown.map((t) => {
          const on1 = t.id === c.active;
          return (
            <li key={t.id} className="comment" data-active={on1 || undefined} data-resolved={t.resolvedAt ? true : undefined}>
              <div className="comment-head">
                <button type="button" className="comment-pick" aria-expanded={on1} onClick={() => pick(t)}>
                  <span className="comment-meta"><span className="comment-n">{t.n}</span><b>{who(t.author)}</b><span>{placed(t, wholeWords)}, {timeAgo(t.createdAt)}{t.resolvedAt ? ", resolved" : ""}</span></span>
                  <span className="comment-text">{t.text}</span>
                </button>
                {on1 && <IconButton label={`Delete comment ${t.n}`} onClick={() => setDeleting(t)}><Trash2 size={14} /></IconButton>}
              </div>
              {t.replies.map((r) => <p key={r.id} className="comment-reply"><b>{who(r.author)}</b> {r.text}</p>)}
              {on1 && <>
                <div className="comment-actions">
                  {!t.resolvedAt && <Button size="sm" tip="Your model looks at the spot, makes the change and answers here." onClick={() => void ask([t])}><Sparkles size={14} aria-hidden /> Ask your model to do this</Button>}
                  {t.resolvedAt
                    ? <Button size="sm" variant="ghost" onClick={() => void act(api.comments.update(t.id, { resolved: false }), `Comment ${t.n} is open again`)}><RotateCcw size={14} aria-hidden /> Open again</Button>
                    : <Button size="sm" variant="ghost" onClick={() => void act(api.comments.update(t.id, { resolved: true }), `Resolved comment ${t.n}`)}><Check size={14} aria-hidden /> Resolve</Button>}
                </div>
                <form className="comment-reply-form" onSubmit={(e) => { e.preventDefault(); const said = reply.trim(); if (said) void act(api.comments.reply(t.id, { text: said }).then(() => setReply(""))); }}>
                  <Textarea aria-label={`Reply to comment ${t.n}`} rows={2} value={reply} placeholder="Reply" onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
                  {reply.trim() && <Button size="sm" variant="primary" type="submit">Reply</Button>}
                </form>
              </>}
            </li>
          );
        })}
      </ol>}
      {!threads.length && !c.picking && <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Pin a comment to the spot that should change. Your model can read each one and do what it says.</p>}

      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete comment ${deleting?.n ?? ""}?`}
        description={deleting?.replies.length ? `Its ${deleting.replies.length} ${deleting.replies.length === 1 ? "reply goes" : "replies go"} with it.` : "It cannot be brought back."} confirmLabel="Delete the comment"
        onConfirm={async () => { const t = deleting!; await act(api.comments.remove(t.id), `Deleted comment ${t.n}`); if (c.active === t.id) c.setActive(null); }} />
    </section>
  );
}

/** A knit with its comments: pins over the picture or the video, and the threads under it. */
export function KnitWithComments({ knit, src }: { knit: KnitRecord; src: string }) {
  const video = knit.kind === "video";
  const on: CommentsOn = { kind: "knit", projectId: knit.projectId, knitId: knit.id, label: knit.label, patternId: knit.patternId, video };
  const { threads, refresh } = useComments(on);
  const c = useCommentState();
  const player = useRef<HTMLVideoElement>(null);
  const [at, setAt] = useState(0);
  const now = () => (player.current ? player.current.currentTime * 1000 : 0);
  return <>
    <div className="knit-stage">
      <div className="pin-media" data-picking={c.picking || undefined}>
        {video
          ? <video ref={player} src={src} controls onTimeUpdate={(e) => setAt(e.currentTarget.currentTime * 1000)} onSeeked={(e) => setAt(e.currentTarget.currentTime * 1000)} />
          : <img src={src} alt={knit.label} />}
        <Pins threads={shownThreads(threads, c)} draft={c.draft} active={c.active} at={video ? at : undefined}
          onPick={(t) => { c.setActive(t.id); if (t.timeMs != null && player.current) { player.current.pause(); player.current.currentTime = t.timeMs / 1000; } }} />
        {c.picking && !c.draft && <PinCatch label={`Place comment here${video ? ", at this moment" : ""}`} onSpot={(x, y) => { player.current?.pause(); c.setDraft({ x, y, ...(video ? { timeMs: Math.round(now()) } : {}) }); c.setActive(null); }} />}
      </div>
    </div>
    <CommentThreads on={on} threads={threads} c={c} refresh={refresh} wholeWords={video ? "video" : "knit"} moment={video ? now : undefined}
      hint={video ? "Find the moment with the controls, then click the spot that should change." : "Click the spot that should change."}
      onGo={(t) => { if (t.timeMs != null && player.current) { player.current.pause(); player.current.currentTime = t.timeMs / 1000; } }} />
  </>;
}

