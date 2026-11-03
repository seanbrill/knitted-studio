"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, type AgentJob } from "@knitted/core/client";
import { Button, Textarea, icons, useToast } from "@knitted/ui";
import { useEditor } from "@/lib/editor/store";
import { useLive } from "@/lib/hooks";

const { Lock, Sparkles } = icons;

const describe = (e: NonNullable<AgentJob["progress"]>["events"][number]) =>
  e.type === "text" ? e.text : e.type === "tool_call" ? `Working: ${e.name.replace(/_/g, " ")}` : e.type === "tool_result" ? `${e.name.replace(/_/g, " ")}: ${e.summary}` : e.type === "refusal" ? `Could not change ${e.slot}: ${e.why}` : e.why;

/** Ask your model to work on this pattern. It follows the locks you do, and everything it does can be undone as one. */
export function AskPanel({ projectId }: { projectId: string }) {
  const st = useEditor();
  const toast = useToast();
  const { data: cfg } = useLive(() => api.agent.config(), []);
  const [prompt, setPrompt] = useState("");
  const [suggest, setSuggest] = useState(false);
  const [job, setJob] = useState<AgentJob | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [kept, setKept] = useState(false);
  const busy = !!job && (job.status === "queued" || job.status === "running");
  const lockedCount = st.pattern.stitches.filter((s) => s.locked).length;
  const finished = useRef(new Set<string>());

  useEffect(() => {
    if (!job || !busy) return;
    const t = setInterval(async () => {
      try {
        const j = await api.agent.job(job.id);
        setJob(j);
        if (j.status !== "queued" && j.status !== "running" && !finished.current.has(j.id)) { finished.current.add(j.id); await st.reload(); }
      } catch { /* the next tick tries again */ }
    }, 700);
    return () => clearInterval(t);
  }, [job?.id, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setError(undefined); setKept(false); setJob(null);
    try { setJob(await api.agent.start({ projectId, patternId: st.pattern.id, prompt, mode: suggest ? "suggest" : "edit" })); setPrompt(""); } catch (e) { setError((e as Error).message); }
  };
  const undoAll = async () => {
    const r = job?.result; if (!r?.baselineRevisionId || !r.patternId) return;
    try { await api.patterns.restore(r.patternId, r.baselineRevisionId); await st.reload(); setKept(true); toast("Put back the way it was."); } catch (e) { setError((e as Error).message); }
  };

  if (cfg && !cfg.key.present) {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <h3 className="h4" style={{ margin: 0 }}>Ask your model</h3>
        <p className="body-sm" style={{ color: "var(--ink-muted)", margin: 0 }}>Add your own Anthropic key and your model can write copy, change layouts and knit posts for you.</p>
        <Link className="link body-sm" href="/settings">Add a key in Settings</Link>
      </div>
    );
  }
  const r = job?.result;
  const events = job?.progress?.events ?? [];
  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <h3 className="h4" style={{ margin: 0 }}>Ask your model</h3>
      <span className="chip body-sm" style={{ display: "inline-flex", gap: 4, alignItems: "center", justifySelf: "start" }}>
        <Lock size={12} aria-hidden /> Working on {st.pattern.name}{lockedCount ? `, ${lockedCount} locked` : ""}
      </span>
      <Textarea aria-label="What should your model do?" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Write a headline about the spring sale and make the button orange" disabled={busy} />
      <label className="body-sm" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} disabled={busy} /> Suggest only (works on a copy)
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="primary" onClick={run} disabled={busy || !prompt.trim()}><Sparkles size={14} aria-hidden /> {busy ? "Working..." : "Ask"}</Button>
        {busy && job && <Button onClick={() => api.agent.cancel(job.id)}>Stop</Button>}
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {events.length > 0 && (
        <ol aria-label="What your model did" aria-live="polite" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }} className="body-sm">
          {events.map((e, i) => <li key={i} style={{ color: e.type === "refusal" ? "var(--danger)" : undefined }}>{describe(e)}</li>)}
        </ol>
      )}
      {job?.status === "failed" && <p className="field-error" role="alert">{job.error}</p>}
      {job?.status === "cancelled" && <p className="body-sm">Stopped.</p>}
      {r && (
        <div className="card" style={{ padding: "var(--space-3)", display: "grid", gap: 8 }} role="status">
          {r.text && <p className="body-sm" style={{ margin: 0 }}>{r.text}</p>}
          {r.refusals.length > 0 && <p className="body-sm" style={{ margin: 0 }}>{r.refusals.length} change{r.refusals.length === 1 ? " was" : "s were"} refused because of locks.</p>}
          {r.suggestion ? (
            <Link className="link body-sm" href={`/projects/${projectId}/patterns/${r.suggestion}`}>Open the suggestion</Link>
          ) : r.changedCount > 0 && !kept ? (
            <>
              <p className="body-sm" style={{ margin: 0 }}>{r.changedCount} change{r.changedCount === 1 ? "" : "s"} made.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <Button onClick={() => setKept(true)}>Keep</Button>
                <Button variant="danger" onClick={undoAll} disabled={!r.baselineRevisionId}>Undo all</Button>
              </div>
            </>
          ) : kept ? <p className="body-sm" style={{ margin: 0 }}>Done.</p> : null}
        </div>
      )}
    </div>
  );
}
