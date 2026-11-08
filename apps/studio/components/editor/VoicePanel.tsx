"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, type JobItem } from "@knitted/core/client";
import { Button, Field, Select, Slider, Switch, Textarea, icons, useToast } from "@knitted/ui";
import { useEditor } from "@/lib/editor/store";
import { useLive } from "@/lib/hooks";

const { Trash2 } = icons;
const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Voiceover: a script in, sound on the timeline out, with captions if you want them. */
export function VoicePanel({ projectId }: { projectId: string }) {
  const st = useEditor();
  const toast = useToast();
  const { data: v } = useLive(() => api.voice.voices(), []);
  const { data: cfg } = useLive(() => api.voice.config(), []);
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState<string | undefined>();
  const [speed, setSpeed] = useState(1);
  const [captions, setCaptions] = useState(true);
  const [job, setJob] = useState<JobItem | null>(null);
  const busy = !!job && (job.status === "queued" || job.status === "running");
  // Polls overlap (a slow answer can still be in flight when the next tick fires), so each
  // job is announced exactly once, however many of them see it finish.
  const announced = useRef(new Set<string>());
  const audio = st.pattern.motion?.audio ?? [];

  useEffect(() => {
    if (!job || !busy) return;
    const t = setInterval(async () => {
      const j = await api.knit.job(job.id).catch(() => null);
      if (!j) return;
      setJob(j);
      if ((j.status === "done" || j.status === "failed") && !announced.current.has(j.id)) {
        announced.current.add(j.id);
        if (j.status === "done") { await st.reload(); toast("Voiceover added to the timeline."); }
        else toast(j.error ?? "The voiceover could not be made.");
      }
    }, 500);
    return () => clearInterval(t);
  }, [job?.id, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Said | shown": the caption shows the words after the bar, like a command, while the voice says the words before it.
  const lines = script.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const bar = l.indexOf(" | ");
    return bar > 0 ? { say: l.slice(0, bar).trim(), show: l.slice(bar + 3).trim() || undefined } : l;
  });
  const warnings = job?.status === "done" ? (job.progress?.units ?? []).flatMap((u) => u.issues ?? []).map((i) => i.message) : [];
  const go = async () => {
    try { setJob(await api.voice.generate(st.pattern.id, { lines, voice: voice ?? cfg?.voice, speed, startMs: Math.max(500, Math.round(st.playhead)), captions })); setScript(""); }
    catch (e) { toast((e as Error).message); }
  };
  const remove = (id: string) => st.dispatch({ type: "setAudio", audio: audio.filter((a) => a.id !== id) }, { label: "Remove sound" });
  const unavailable = v && !v.available;

  return (
    <div>
      <h2 className="eyebrow" style={{ margin: "0 0 var(--space-3)" }}>Voice</h2>
      {unavailable && (
        <div className="panel" role="alert" style={{ padding: 10, marginBottom: 12 }}>
          <p className="body-sm" style={{ margin: "0 0 6px" }}>{v.provider === "system" ? "No built-in voice was found on this computer." : "The voice you picked is not ready yet."}</p>
          <Link className="link body-sm" href="/settings">Choose a voice in Settings</Link>
        </div>
      )}
      <Field label="What should it say?" hint="One line per spoken sentence. Each becomes its own clip you can move. To caption a line with other words, like a command, put them after a bar: Roll it back from the terminal | filefreak sites rollback 3" htmlFor="vp-script">
        <Textarea id="vp-script" rows={5} value={script} onChange={(e) => setScript(e.target.value)} placeholder={"Make it knitted.\nPattern once. Knit forever."} />
      </Field>
      {v && v.voices.length > 1 && (
        <div style={{ marginTop: 10 }}><Field label="Voice"><Select aria-label="Voice" value={voice ?? cfg?.voice ?? "default"} onValueChange={setVoice} options={v.voices.slice(0, 60).map((x) => ({ value: x.id, label: x.label }))} /></Field></div>
      )}
      <div style={{ marginTop: 10 }}><Slider label="Speed" value={speed} min={0.7} max={1.4} step={0.05} unit="x" onChange={setSpeed} /></div>
      <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "12px 0" }}><span className="body-sm">Add captions<br /><span style={{ color: "var(--ink-muted)" }}>Timed to each line.</span></span><Switch label="Add captions" checked={captions} onCheckedChange={setCaptions} /></label>
      <Button variant="primary" block disabled={!lines.length || busy || !!unavailable} onClick={go}>{busy ? `Speaking ${job?.progress?.done ?? 0} of ${job?.progress?.total ?? lines.length}...` : `Make voiceover${lines.length > 1 ? ` (${lines.length} lines)` : ""}`}</Button>
      {job?.status === "failed" && <p className="field-error" role="alert" style={{ marginTop: 8 }}>{job.error}</p>}
      {warnings.length > 0 && (
        <ul className="body-sm" aria-label="About this voiceover" style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--ink-muted)" }}>
          {warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}

      <h3 className="eyebrow" style={{ margin: "var(--space-6) 0 var(--space-2)" }}>On the timeline</h3>
      {audio.length === 0 ? <p className="body-sm" style={{ color: "var(--ink-muted)" }}>No sound yet.</p> : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {audio.map((a) => (
            <li key={a.id} className="card" style={{ padding: "6px 8px", display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="label" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label ?? (a.kind === "music" ? "Music" : "Voice")}</span>
                <span className="eyebrow">{a.kind} · from {fmt(a.startMs)}</span>
              </span>
              <button className="icon-btn" aria-label={`Remove ${a.label ?? a.kind}`} onClick={() => remove(a.id)}><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      {audio.some((a) => a.kind === "voice") && <a className="link body-sm" style={{ display: "inline-block", marginTop: 10 }} href={`/api/patterns/${st.pattern.id}/captions.srt`}>Download subtitles (.srt)</a>}
      <MusicPicker projectId={projectId} />
    </div>
  );
}

/** Pick audio Yarn as a music bed: it loops under the voice and ducks when someone speaks. */
function MusicPicker({ projectId }: { projectId: string }) {
  const st = useEditor();
  void projectId;
  const music = Object.values(st.yarn).filter((y) => y.kind === "audio" && !y.tags.includes("voiceover"));
  if (!music.length) return <p className="body-sm" style={{ color: "var(--ink-muted)", marginTop: 14 }}>Upload an audio file in Yarn to use it as music.</p>;
  return (
    <div style={{ marginTop: 14 }}>
      <Field label="Add music from Yarn">
        <Select aria-label="Add music" value="" onValueChange={(id) => {
          const y = st.yarn[id]; const cur = st.pattern.motion?.audio ?? [];
          st.dispatch({ type: "setAudio", audio: [...cur, { id: `au_${Math.random().toString(36).slice(2, 8)}`, yarnId: id, startMs: 0, kind: "music", gain: 0.5, fadeOutMs: 800, loop: true, label: y.name }] }, { label: "Add music" });
        }} options={music.map((y) => ({ value: y.id, label: y.name }))} placeholder="Choose a track" />
      </Field>
    </div>
  );
}
