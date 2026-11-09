"use client";

// Make a photo or a short video with the person's own provider key: what to make, the pictures
// to work from, its shape and quality, and what it will cost, worked out as they choose. It is
// made as a job; the person keeps working, and hears when it is in Yarn.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, type GenPlanView, type GenRequest } from "@knitted/core/client";
import { GEN_ASPECTS, VIDEO_ASPECTS, type GenAspect, type GenKind, type GenQuality, type Yarn } from "@knitted/core";
import { Button, Chip, Dialog, Field, SegmentedControl, Select, Textarea, icons, useToast } from "@knitted/ui";

const { Wand2, X, AlertTriangle } = icons;
const KINDS: { value: GenKind; label: string }[] = [{ value: "image", label: "Photo" }, { value: "video", label: "Video" }];
const QUALITY: { value: GenQuality; label: string }[] = [{ value: "draft", label: "Draft" }, { value: "good", label: "Good" }, { value: "best", label: "Best" }];
const SHAPE: Record<GenAspect, string> = { "1:1": "Square", "4:5": "Feed 4:5", "9:16": "Story 9:16", "16:9": "Wide 16:9", "3:2": "3:2", "2:3": "2:3" };

export interface MakeStart { kind?: GenKind; from?: Yarn[] }

/** The dialog, and the jobs it started: each says when it is done, then `onMade` runs. */
export function MakeDialog({ projectId, folder, start, onClose, onMade }: { projectId: string; folder?: string; start: MakeStart | null; onClose: () => void; onMade: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<GenKind>("image");
  const [prompt, setPrompt] = useState("");
  const [from, setFrom] = useState<Yarn[]>([]);
  const [count, setCount] = useState("1");
  const [aspect, setAspect] = useState<GenAspect>("1:1");
  const [quality, setQuality] = useState<GenQuality>("good");
  const [seconds, setSeconds] = useState("6");
  const [plan, setPlan] = useState<GenPlanView | null>(null);
  const [why, setWhy] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<{ id: string; say: string }[]>([]);
  const open = !!start;

  useEffect(() => {
    if (!start) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKind(start.kind ?? "image"); setFrom(start.from ?? []); setPrompt(""); setWhy(undefined); setBusy(false);
    setAspect(start.kind === "video" ? "9:16" : "1:1");
  }, [start]);

  const ask: GenRequest = { kind, prompt: prompt.trim() || "a photo", from: from.map((y) => y.id), aspect, quality, folder, ...(kind === "video" ? { seconds: Number(seconds) } : { count: Number(count) }) };
  const key = JSON.stringify({ ...ask, prompt: "" });
  // What it will be and cost, as they choose: not on each letter typed, which changes neither.
  useEffect(() => {
    if (!open) return;
    let live = true;
    api.generate.estimate(projectId, ask).then((r) => { if (live) { setPlan(r.plan); setWhy(undefined); } }).catch((e) => { if (live) { setPlan(null); setWhy((e as Error).message); } });
    return () => { live = false; };
  }, [open, projectId, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each job, followed until it ends, and told once: on a slow machine one look can still be
  // waiting when the next starts, and both would see it done.
  const told = useRef(new Set<string>());
  const looking = useRef(false);
  useEffect(() => {
    if (!jobs.length) return;
    const t = setInterval(async () => {
      if (looking.current) return;
      looking.current = true;
      try {
        for (const j of jobs) {
          if (told.current.has(j.id)) continue;
          const now = await api.generate.job(j.id).catch(() => null);
          if (!now || !["done", "failed", "cancelled", "interrupted"].includes(now.status) || told.current.has(j.id)) continue;
          told.current.add(j.id);
          setJobs((js) => js.filter((x) => x.id !== j.id));
          if (now.status === "done" && now.result) {
            const n = now.result.yarn.length;
            toast(`${n === 1 ? now.result.yarn[0].name : `${n} new files`} ${n === 1 ? "is" : "are"} in Yarn. It cost $${now.result.cost.toFixed(2)}.`);
            onMade();
          } else toast(now.error ?? "It could not be made.");
        }
      } finally { looking.current = false; }
    }, 2000);
    return () => clearInterval(t);
  }, [jobs, toast, onMade]);

  const make = async () => {
    if (!prompt.trim()) { setWhy("Say what to make."); return; }
    setBusy(true);
    try {
      const r = await api.generate.start(projectId, { ...ask, prompt: prompt.trim() });
      setJobs((js) => [...js, { id: r.job.id, say: r.plan.say }]);
      onClose();
      toast(`Making ${r.plan.say}. It takes ${kind === "video" ? "a few minutes" : "a minute or two"}; keep working.`);
    } catch (e) { setWhy((e as Error).message); setBusy(false); }
  };

  const shapes = (kind === "video" ? VIDEO_ASPECTS : GEN_ASPECTS).map((a) => ({ value: a, label: SHAPE[a] }));
  const noKey = why && /Settings, Generate/.test(why);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} wide title="Make a photo or video" description="Made by your own provider, from what you say and your pictures, and kept in Yarn. It is charged to your key."
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !plan} onClick={make}><Wand2 size={14} aria-hidden /> {busy ? "Starting..." : plan ? `Make it, about $${plan.cost.toFixed(2)}` : "Make it"}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void make(); }} style={{ display: "grid", gap: "var(--space-4)" }}>
        <SegmentedControl<GenKind> label="Make a" value={kind} onChange={(k) => { setKind(k); setAspect(k === "video" ? "9:16" : "1:1"); if (k === "video") setFrom((f) => f.slice(0, 2)); }} options={KINDS} />
        <Field label="What to make" htmlFor="make-what" hint={kind === "video" ? "What happens, how the camera moves, the light, and the sound." : "The subject, the setting, the light and the framing. Leave words out: set them in the pattern."}>
          <Textarea id="make-what" autoFocus rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder={kind === "video" ? "Our mascot waves at the camera, then hops out of frame. Bright morning light. A cheerful whistle." : "Our latte on a white marble counter, morning light from the left, shot from above, room for a headline at the top."} />
        </Field>
        {from.length > 0 && (
          <div>
            <p className="label" style={{ margin: "0 0 6px" }}>Working from</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {from.map((y) => <Chip key={y.id}>{y.name}<button type="button" className="icon-btn" style={{ width: 18, height: 18 }} aria-label={`Do not work from ${y.name}`} onClick={() => setFrom((f) => f.filter((x) => x.id !== y.id))}><X size={11} /></button></Chip>)}
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "end" }}>
          <div className="field"><span className="field-label" aria-hidden>Shape</span><SegmentedControl<GenAspect> label="Shape" value={aspect} onChange={setAspect} options={shapes} /></div>
          {kind === "image"
            ? <Field label="How many" htmlFor="make-count"><Select id="make-count" value={count} onValueChange={setCount} options={["1", "2", "3", "4"].map((n) => ({ value: n, label: n }))} /></Field>
            : <Field label="Seconds" htmlFor="make-seconds"><Select id="make-seconds" value={seconds} onValueChange={setSeconds} options={["4", "6", "8", "10", "15"].map((n) => ({ value: n, label: `${n} seconds` }))} /></Field>}
          <div className="field"><span className="field-label" aria-hidden>Quality</span><SegmentedControl<GenQuality> label="Quality" value={quality} onChange={setQuality} options={QUALITY} /></div>
        </div>
        <div role="status" aria-live="polite" className="body-sm" style={{ minHeight: 20 }}>
          {plan && !why && <span style={{ color: "var(--ink-muted)" }}>{plan.say[0].toUpperCase() + plan.say.slice(1)}.</span>}
          {why && <span className="field-error" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><AlertTriangle size={14} aria-hidden /> {why} {noKey && <Link className="link" href="/settings?tab=generate">Open Settings</Link>}</span>}
        </div>
      </form>
    </Dialog>
  );
}
