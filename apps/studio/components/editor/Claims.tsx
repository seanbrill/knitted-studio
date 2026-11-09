"use client";

// The claims check (design sheet f47), in the Inspector with nothing selected, under Before it
// knits: what the words say about the business, read beside the Brief by the person's model.
// Each claim the Brief does not back shows what the Brief says, a true way to say it where
// there is one (Use this wording puts it in the quote's place, as one change to undo), and
// Show it, which picks its text. The words changed since the check make it out of date.
//
// A check is kept for the pattern while the studio is open, so leaving the editor and coming
// back does not ask the model again.

import Link from "next/link";
import { useRef, useState } from "react";
import { ApiError, api } from "@knitted/core/client";
import { applyFix, claimWords, placeQuote, sameWords, type Claim, type ClaimsCheck } from "@knitted/core";
import { Button } from "@knitted/ui";
import { liveStitches, useEditor } from "@/lib/editor/store";
import { useLive } from "@/lib/hooks";
import { Section } from "./controls";

interface Kept { check: ClaimsCheck; changed: string[] }
const kept = new Map<string, Kept>();

const VERDICT: Record<Claim["verdict"], { label: string; mark: string }> = {
  against: { label: "Against the Brief", mark: "!" },
  notyet: { label: "Not available yet", mark: "!" },
  missing: { label: "Not in the Brief", mark: "?" },
  backed: { label: "Backed by the Brief", mark: "✓" },
};

const muted = { margin: 0, color: "var(--ink-muted)" } as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function Claims() {
  const st = useEditor();
  const { pattern } = st;
  const words = claimWords({ stitches: liveStitches(st), html: pattern.html });
  const { data: cfg } = useLive(() => api.agent.config(), []);
  const { data: brief } = useLive(() => api.brief.get(pattern.projectId), [pattern.projectId]);
  const [state, setState] = useState<Kept | null>(() => kept.get(pattern.id) ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);

  const keep = (k: Kept | null) => { if (k) kept.set(pattern.id, k); else kept.delete(pattern.id); setState(k); };
  const noKey = !!cfg && !cfg.key.present;
  const emptyBrief = !!brief && !brief.profile.trim() && !brief.notes.trim();

  async function check() {
    const ac = new AbortController();
    stop.current = ac;
    setBusy(true); setError(null);
    try {
      keep({ check: await api.patterns.claims(pattern.id, ac.signal), changed: [] });
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof ApiError || e instanceof Error ? e.message : "The check did not finish. Try again.");
    } finally {
      if (stop.current === ac) { stop.current = null; setBusy(false); }
    }
  }
  function cancel() { stop.current?.abort(); stop.current = null; setBusy(false); }

  /** The fix in the quote's place, as one change; the check then knows the words it made. */
  function takeWording(c: Claim) {
    if (!state || !c.stitchId || !c.fix) return;
    const next = applyFix(words[c.stitchId] ?? "", c.quote, c.fix);
    if (next === null) { setError("That text has changed since the check. Check the claims again."); return; }
    const refused = st.dispatch({ type: "updateStitch", id: c.stitchId, patch: { content: next } }, { label: "Use the Brief's wording" });
    if (refused.length) { setError(refused[0].why); return; }
    const after = { ...state.check.words, [c.stitchId]: next };
    // Another claim in the same text may have moved, or gone with this one. This one keeps its
    // text, to know it is changed while the text says the new wording, and not after an undo.
    const claims = state.check.claims.map((x) => {
      if (x.quote === c.quote) return { ...x, replaceable: false };
      const at = placeQuote(after, x.quote);
      return { ...x, stitchId: at?.stitchId ?? null, replaceable: !!at?.replaceable && !!x.fix };
    });
    keep({ check: { ...state.check, words: after, claims }, changed: [...state.changed, c.quote] });
  }

  const intro = <p className="body-sm" style={muted}>What the words say about the business, read beside the Brief by your model. A claim the Brief does not back is one to check before it is posted.</p>;
  const failed = error ? <p className="body-sm" role="alert" style={{ margin: 0, color: "var(--danger)" }}>{error}</p> : null;
  const running = busy ? (
    <div style={{ display: "grid", gap: 8 }}>
      <p className="body-sm" role="status" style={muted}>Your model is reading the words beside the Brief.</p>
      <div className="skeleton" aria-hidden style={{ height: 64, borderRadius: 8 }} />
      <div><Button size="sm" variant="ghost" onClick={cancel}>Stop</Button></div>
    </div>
  ) : null;

  if (!state) {
    return (
      <Section title="Claims" hint="What the words say about the business, read beside the Brief by your model.">
        {noKey ? (
          <div className="claims-empty" role="note" aria-label="Checking needs a key">
            <p className="body-sm" style={muted}>Checking reads the words with your model. Add your Anthropic key in Settings, or connect Claude Code and ask it to check the claims: it has check_claims.</p>
            <p className="claims-links"><Link className="link body-sm" href="/settings?tab=model">Add a key in Settings</Link><Link className="link body-sm" href="/settings?tab=model#claude-code">Connect Claude Code</Link></p>
          </div>
        ) : emptyBrief ? (
          <div className="claims-empty" role="note" aria-label="The Brief is empty">
            <p className="body-sm" style={muted}>There is nothing to check them against yet. Write the Brief, or sync it from the website.</p>
            <p className="claims-links"><Link className="link body-sm" href={`/projects/${pattern.projectId}/brief`}>Open the Brief</Link></p>
          </div>
        ) : busy ? running : (
          <>
            {intro}
            <div><Button size="sm" onClick={() => void check()}>Check the claims</Button></div>
            <p className="body-sm" style={muted}>Uses your model, as Ask does. The words and the Brief go to it, nothing else.</p>
            {failed}
          </>
        )}
      </Section>
    );
  }

  const { check: result, changed } = state;
  const stale = !sameWords(result.words, words);
  const open = result.claims.filter((c) => c.verdict !== "backed");
  const backed = result.claims.filter((c) => c.verdict === "backed");
  // Changed while its text still says the Brief's wording: an undo puts the claim back.
  const isDone = (c: Claim) => changed.includes(c.quote) && !!c.stitchId && !!c.fix && (words[c.stitchId] ?? "").includes(c.fix);
  const left = open.filter((c) => !isDone(c));
  const toFix = left.filter((c) => c.verdict === "against" || c.verdict === "notyet").length;
  const toCheck = left.filter((c) => c.verdict === "missing").length;
  const summary = [toFix && `${toFix} to fix`, toCheck && `${toCheck} to check`].filter(Boolean).join(", ");
  return (
    <Section title="Claims" hint="What the words say about the business, read beside the Brief by your model.">
      {stale && !busy ? (
        <p className="body-sm claims-stale" role="status">The words changed since this check. <button type="button" className="link" onClick={() => void check()}>Check again</button></p>
      ) : null}
      {busy ? running : null}
      {failed}
      {!busy && (
        <>
          <p className="body-sm" role={stale ? undefined : "status"} style={muted}>
            {result.claims.length === 0 ? "No claims on it: nothing about what the business does, costs or has done for the Brief to back."
              : [summary || (left.length < open.length ? "Nothing left to fix" : ""), backed.length ? `${backed.length} backed by the Brief` : ""].filter(Boolean).join(" · ") + "."}
          </p>
          {open.length > 0 && (
            <ul aria-label="Claims to look at" className="claims-list" data-stale={stale || undefined}>
              {open.map((c) => {
                const v = VERDICT[c.verdict];
                const done = isDone(c);
                return (
                  <li key={c.quote} className="claim-card" data-verdict={c.verdict} data-done={done || undefined}>
                    <p className="claim-head"><span className="claim-mark" aria-hidden>{done ? "✓" : v.mark}</span>{done ? "Changed to the Brief's wording" : v.label}</p>
                    <p className="claim-quote">&ldquo;{done ? c.fix : c.quote}&rdquo;</p>
                    {!done && (c.brief ? (
                      <div><p className="claim-label">The Brief</p><p className="body-sm claim-text">&ldquo;{c.brief}&rdquo;</p></div>
                    ) : c.why ? (
                      <div><p className="claim-label">Why</p><p className="body-sm claim-text">{c.why}</p></div>
                    ) : null)}
                    {!done && c.fix ? <div className="claim-say"><p className="claim-label">Say instead</p><p className="body-sm claim-text">{c.fix}</p></div> : null}
                    {!done && (c.replaceable || c.stitchId) ? (
                      <div className="claim-actions">
                        {c.replaceable && !stale ? <Button size="sm" onClick={() => takeWording(c)} aria-label={`Use this wording in place of “${c.quote}”`}>Use this wording</Button> : null}
                        {c.stitchId ? <button type="button" className="link body-sm" onClick={() => st.select([c.stitchId!])} aria-label={`Show it on the canvas: “${c.quote}”`}>Show it</button> : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {backed.length > 0 && (
            <details className="claims-backed">
              <summary className="body-sm"><span aria-hidden>✓ </span>{plural(backed.length, "claim")} backed by the Brief</summary>
              <ul aria-label="Claims the Brief backs">
                {backed.map((c) => (
                  <li key={c.quote} className="body-sm">
                    <span className="claim-quote">&ldquo;{c.quote}&rdquo;</span>
                    {c.brief ? <span className="claim-text"> The Brief: &ldquo;{c.brief}&rdquo;</span> : null}
                    {c.stitchId ? <> <button type="button" className="link body-sm" onClick={() => st.select([c.stitchId!])} aria-label={`Show it on the canvas: “${c.quote}”`}>Show it</button></> : null}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!stale ? <p className="body-sm" style={muted}><button type="button" className="link" onClick={() => void check()}>Check again</button></p> : null}
        </>
      )}
    </Section>
  );
}
