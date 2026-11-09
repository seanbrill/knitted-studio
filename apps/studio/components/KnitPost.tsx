"use client";

// What goes with a knit when it is posted: its caption, hashtags and a track from the
// project's music. Your model writes them, writes them again, or again with what you say to
// change; and you can change any of it yourself. Each network's limit is shown as you write,
// and the captions written over are kept, to go back to.

import { useEffect, useRef, useState } from "react";
import { PLATFORMS, PLATFORM_IDS, captionLength, fullCaption } from "@knitted/core";
import { api, yarnFileUrl, type KnitRecord } from "@knitted/core/client";
import { Button, Select, Textarea, icons, useToast } from "@knitted/ui";
import { timeAgo, useLive } from "@/lib/hooks";

const { Sparkles, RotateCw, X, Plus, Square, Check } = icons;
const NONE = "none";

/** One press each: what people ask of a caption most. */
const QUICK: { label: string; ask: string }[] = [
  { label: "Shorter", ask: "Make it shorter." },
  { label: "Longer", ask: "Make it longer: a few short paragraphs that tell more of the story." },
  { label: "More playful", ask: "Make it more playful." },
  { label: "More professional", ask: "Make it more professional." },
  { label: "For LinkedIn", ask: "Write it for LinkedIn." },
  { label: "For X", ask: "Write it for X: within 280 characters, hashtags included." },
];

export function KnitPost({ knit, onChanged }: { knit: KnitRecord; onChanged: (k: KnitRecord) => void }) {
  const toast = useToast();
  const { data: tracks } = useLive(() => api.yarn.list(knit.projectId, { kind: "audio" }), [knit.projectId]);
  const p = knit.post;
  const has = !!p.caption;
  const [caption, setCaption] = useState(p.caption ?? "");
  const [tag, setTag] = useState("");
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [own, setOwn] = useState(false);
  const stop = useRef<AbortController | null>(null);
  // What the model or another window wrote replaces what is here, unless it is being written.
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setCaption(p.caption ?? ""); }, [p.caption, p.at]);
  useEffect(() => () => stop.current?.abort(), []);

  const write = async (what?: string, label = "again") => {
    const ctl = new AbortController(); stop.current = ctl;
    setBusy(label);
    try { onChanged(await api.knit.writePost(knit.id, what?.trim() || undefined, ctl.signal)); setAsk(""); }
    catch (e) { if (!ctl.signal.aborted) toast.problem((e as Error).message || "Your model could not write it. Try again."); }
    finally { if (stop.current === ctl) stop.current = null; setBusy(null); }
  };
  const save = async (change: Parameters<typeof api.knit.setPost>[1]) => {
    try { onChanged(await api.knit.setPost(knit.id, change)); } catch (e) { toast.problem((e as Error).message); }
  };
  const tags = p.hashtags ?? [];
  const track = tracks?.find((t) => t.id === p.audioId);
  const text = fullCaption(caption, tags);
  const earlier = p.earlier ?? [];

  return (
    <section aria-label="The post" className="post-tab">
      {has || caption || own ? (<>
        <div className="post-field">
          <label className="label" htmlFor={`caption-${knit.id}`}>Caption</label>
          <Textarea id={`caption-${knit.id}`} rows={7} value={caption} disabled={!!busy}
            onFocus={() => { editing.current = true; }}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => { editing.current = false; if (caption !== (p.caption ?? "")) void save({ caption }); }} />
          <p className="post-meta">{p.by === "model" ? "By your model" : "By you"}{p.ask && p.by === "model" ? `, asked: ${p.ask}` : ""} · {[...caption].length.toLocaleString()} characters</p>
          <ul className="fit-chips" aria-label="How it fits each network, hashtags included">
            {PLATFORM_IDS.map((id) => {
              const n = captionLength(id, text), max = PLATFORMS[id].caption, over = n > max;
              return <li key={id} data-over={over || undefined} title={`${n.toLocaleString()} of ${max.toLocaleString()} characters on ${PLATFORMS[id].name}`}>
                {PLATFORMS[id].name} {over ? `${n.toLocaleString()} of ${max.toLocaleString()}` : <Check size={11} aria-label="fits" />}
              </li>;
            })}
          </ul>
        </div>

        <div className="post-field">
          <span className="label" id={`tags-${knit.id}`}>Hashtags</span>
          <ul className="tag-chips" aria-labelledby={`tags-${knit.id}`}>
            {tags.map((t) => <li key={t}>{t}<button type="button" aria-label={`Remove ${t}`} onClick={() => void save({ hashtags: tags.filter((x) => x !== t) })}><X size={11} /></button></li>)}
            <li className="tag-add">
              <Plus size={12} aria-hidden />
              <input aria-label="Add a hashtag" placeholder="Add" value={tag} onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " " || e.key === ",") && tag.trim()) { e.preventDefault(); void save({ hashtags: [...tags, ...tag.split(/[\s,]+/)] }); setTag(""); } }}
                onBlur={() => { if (tag.trim()) { void save({ hashtags: [...tags, ...tag.split(/[\s,]+/)] }); setTag(""); } }} />
            </li>
          </ul>
        </div>

        <div className="post-field">
          <span className="label">Music</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ minWidth: 220, flex: "1 1 220px" }}>
              <Select aria-label="Music" value={p.audioId ?? NONE} onValueChange={(v) => void save({ audioId: v === NONE ? null : v })}
                options={[{ value: NONE, label: tracks?.length ? "No music" : "No music in Yarn yet" }, ...(tracks ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
            </div>
            {track && <audio controls preload="none" src={yarnFileUrl(track)} style={{ height: 32, maxWidth: "100%" }} aria-label={`Play ${track.name}`} />}
          </div>
          {track && p.audioWhy && p.by === "model" && <p className="post-meta">{p.audioWhy}</p>}
        </div>
      </>) : (
        <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Your model writes a caption and hashtags from the Brief and the post, and picks a track from the project&apos;s music. Then change any of it here, or ask for another. Or <button type="button" className="link" onClick={() => setOwn(true)}>write it yourself</button>.</p>
      )}

      <div className="post-ask" aria-busy={!!busy || undefined}>
        <p className="label" style={{ margin: 0 }}>{has ? "Change it with your model" : "Write it with your model"}</p>
        {has && <div className="quick-chips">
          {QUICK.map((q) => <button key={q.label} type="button" className="chip chip-button" disabled={!!busy} aria-busy={busy === q.label || undefined} onClick={() => void write(q.ask, q.label)}>{busy === q.label ? "Writing..." : q.label}</button>)}
        </div>}
        <Textarea aria-label={has ? "What to change" : "Anything to say first"} rows={2} value={ask} disabled={!!busy}
          placeholder={has ? "Or say what to change: mention Saturday, end with a question..." : "Optional: what it is for, who it is for, where it is going"}
          onChange={(e) => setAsk(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) { e.preventDefault(); void write(ask, ask.trim() ? "change" : "again"); } }} />
        <div className="post-ask-actions">
          {earlier.length > 0 && <button type="button" className="link" aria-expanded={earlierOpen} onClick={() => setEarlierOpen((o) => !o)}>Earlier captions ({earlier.length})</button>}
          <span className="grow" />
          {busy
            ? <><span className="post-meta" role="status">Your model is writing...</span><Button size="sm" variant="ghost" onClick={() => stop.current?.abort()}><Square size={12} aria-hidden /> Stop</Button></>
            : has
              ? <><Button size="sm" variant="ghost" onClick={() => void write(undefined, "again")}><RotateCw size={13} aria-hidden /> Write again</Button><Button size="sm" disabled={!ask.trim()} onClick={() => void write(ask, "change")}><Sparkles size={13} aria-hidden /> Change it</Button></>
              : <Button size="sm" onClick={() => void write(ask, "again")}><Sparkles size={13} aria-hidden /> Write caption and hashtags</Button>}
        </div>
        {earlierOpen && earlier.length > 0 && (
          <ol className="earlier-list">
            {earlier.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <p className="post-meta">{e.by === "model" ? "By your model" : "By you"}{e.ask ? `, asked: ${e.ask}` : ""}{e.at ? ` · ${timeAgo(e.at)}` : ""}</p>
                <p className="earlier-text">{e.caption}</p>
                <Button size="sm" variant="ghost" onClick={() => void save({ caption: e.caption, ...(e.hashtags ? { hashtags: e.hashtags } : {}) })}>Use this one</Button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
