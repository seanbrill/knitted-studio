"use client";

// Make a photo or a short video with the person's own provider key: what to make, the pictures
// to work from, its shape and quality, and what it will cost, worked out as they choose. It is
// made as a job; the person keeps working, and hears when it is in Yarn.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, yarnThumbUrl, type GenPlanView, type GenRequest, type UsageSummary } from "@knitted/core/client";
import { estimateCost, GEN_ASPECTS, GEN_SOURCES, money, VIDEO_ASPECTS, VIDEO_RESOLUTION, type GenAspect, type GenKind, type GenQuality, type Yarn } from "@knitted/core";
import { Button, Dialog, Field, Popover, SegmentedControl, Select, Skeleton, Textarea, icons, useToast } from "@knitted/ui";
import { SizeShape } from "./SizeTiles";

const { Wand2, X, AlertTriangle, Plus, Search } = icons;
/** How many pictures each kind can work from: what the providers take. */
const FROM_MAX: Record<GenKind, number> = { image: 6, video: 2 };
const ratio = (a: GenAspect) => a.split(":").map(Number) as [number, number];
const COUNT_WORDS = ["a photo", "2 photos", "3 photos", "4 photos"];
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
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [pool, setPool] = useState<Yarn[] | null>(null);
  const [find, setFind] = useState("");
  const open = !!start;
  useEffect(() => {
    if (!open) return;
    let live = true;
    api.agent.usage().then((u) => live && setUsage(u)).catch(() => live && setUsage(null));
    return () => { live = false; };
  }, [open]);
  // The pictures there are to work from, read when the person first goes to add one.
  const loadPool = () => { if (!pool) api.yarn.list(projectId, { kind: "image" }).then(setPool).catch(() => setPool([])); };

  useEffect(() => {
    if (!start) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKind(start.kind ?? "image"); setFrom(start.from ?? []); setPrompt(""); setWhy(undefined); setBusy(false); setFind("");
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
          } else toast.problem(now.error ?? "It could not be made.");
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

  const aspects = kind === "video" ? VIDEO_ASPECTS : GEN_ASPECTS;
  const noKey = why && /Settings, Generate/.test(why);
  const n = Number(count);
  const what = kind === "video" ? "a video" : COUNT_WORDS[n - 1]!;
  // The price of each choice that changes it, so the one made is never a surprise.
  const at = (q: GenQuality) => plan ? estimateCost({ kind, provider: plan.provider, model: plan.model, count: 1, aspect, quality: q, seconds: Number(seconds) }) : 0;
  const others = (["draft", "good", "best"] as GenQuality[]).filter((q) => q !== quality);
  const name = (q: GenQuality) => QUALITY.find((x) => x.value === q)!.label;
  const each = !plan ? "" : kind === "video"
    ? `${VIDEO_RESOLUTION[quality]}, ${money(plan.cost / plan.seconds)} a second. ${others.map((q) => `${name(q)} would be ${money(at(q))}`).join("; ")}.`
    : `${n > 1 ? `${money(plan.cost / n)} each. ` : ""}${others.map((q, k) => `${name(q)} is ${money(at(q))}${k ? "" : " each"}`).join("; ")}.`;
  const max = FROM_MAX[kind];
  const want = find.trim().toLowerCase();
  const offer = (pool ?? []).filter((y) => !from.some((f) => f.id === y.id) && (!want || y.name.toLowerCase().includes(want))).slice(0, 24);
  const note = usage ? `This month: ${money(usage.month)}${usage.limits.monthly != null ? ` of your ${money(usage.limits.monthly)} limit` : ", with no monthly limit"}` : undefined;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} size="lg" title="Make a photo or video" description="By your own provider, kept in Yarn, charged to your key" note={note}
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!plan} onClick={make}><Wand2 size={14} aria-hidden /> {busy ? "Starting..." : plan ? `Make ${what}, about ${money(plan.cost)}` : `Make ${what}`}</Button></>}>
      <form className="make" onSubmit={(e) => { e.preventDefault(); void make(); }}>
        <div style={{ display: "grid", gap: "var(--space-4)", alignContent: "start" }}>
          <SegmentedControl<GenKind> label="Make a" value={kind} onChange={(k) => { setKind(k); setAspect(k === "video" ? "9:16" : "1:1"); if (k === "video") setFrom((f) => f.slice(0, FROM_MAX.video)); }} options={KINDS} />
          <Field label="What to make" htmlFor="make-what" hint={kind === "video" ? "What happens, how the camera moves, the light, and the sound." : "The subject, the setting, the light and the framing. Leave words out: set them in the pattern."}>
            <Textarea id="make-what" autoFocus rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)}
              placeholder={kind === "video" ? "Our mascot waves at the camera, then hops out of frame. Bright morning light. A cheerful whistle." : "Our latte on a white marble counter, morning light from the left, shot from above, room for a headline at the top."} />
          </Field>
          <div className="field">
            <span className="field-label" id="make-from">Work from <span className="field-optional">{kind === "video" ? "the first frame, and maybe the last" : `up to ${max}`}</span></span>
            <ul className="make-from" aria-labelledby="make-from">
              {from.map((y) => (
                <li key={y.id} className="make-pic" title={y.name}>
                  <img src={yarnThumbUrl(y)} alt={y.name} />
                  <button type="button" aria-label={`Do not work from ${y.name}`} onClick={() => setFrom((f) => f.filter((x) => x.id !== y.id))}><X size={11} aria-hidden /></button>
                </li>
              ))}
              {from.length < max && (
                <li>
                  <Popover align="start" trigger={<button type="button" className="make-pic make-pic-add" aria-label="Add a picture to work from" onClick={loadPool}><Plus size={16} aria-hidden /></button>}>
                    <div className="make-pool">
                      <label className="move-find"><Search size={14} aria-hidden /><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a picture" aria-label="Find a picture" /></label>
                      {!pool ? <Skeleton height={64} /> : offer.length === 0 ? <p className="body-sm muted" style={{ margin: 0 }}>{pool.length ? "No picture is called that." : "No pictures in Yarn yet."}</p> : (
                        <div className="make-pool-grid">
                          {offer.map((y) => <button key={y.id} type="button" className="make-pic" aria-label={`Work from ${y.name}`} title={y.name} onClick={() => setFrom((f) => (f.length < max ? [...f, y] : f))}><img src={yarnThumbUrl(y)} alt="" /></button>)}
                        </div>
                      )}
                    </div>
                  </Popover>
                </li>
              )}
            </ul>
          </div>
          <div className="field">
            <span className="field-label" id="make-shape">Shape</span>
            <div className="knit-sizes" role="radiogroup" aria-labelledby="make-shape">
              {aspects.map((a) => { const [w, h] = ratio(a); return <button key={a} type="button" role="radio" aria-checked={aspect === a} className="knit-size" onClick={() => setAspect(a)}><SizeShape w={w} h={h} box={[22, 18]} />{SHAPE[a]}</button>; })}
            </div>
          </div>
          <div style={{ display: "flex", gap: "var(--space-5)", flexWrap: "wrap", alignItems: "end" }}>
            {kind === "image"
              ? <div className="field"><span className="field-label" aria-hidden>How many</span><SegmentedControl label="How many" value={count} onChange={setCount} options={["1", "2", "3", "4"].map((x) => ({ value: x, label: x }))} /></div>
              : <Field label="Seconds" htmlFor="make-seconds"><Select id="make-seconds" value={seconds} onValueChange={setSeconds} options={["4", "6", "8", "10", "15"].map((x) => ({ value: x, label: `${x} seconds` }))} /></Field>}
            <div className="field"><span className="field-label" aria-hidden>Quality</span><SegmentedControl<GenQuality> label="Quality" value={quality} onChange={setQuality} options={QUALITY} /></div>
          </div>
        </div>
        <aside className="make-cost" aria-label="What it costs">
          <p className="field-label" style={{ margin: 0 }}>What it costs</p>
          <div role="status" aria-live="polite" style={{ display: "grid", gap: 6 }}>
            {why ? <p className="field-error" style={{ margin: 0, display: "flex", gap: 6, alignItems: "flex-start" }}><AlertTriangle size={14} aria-hidden style={{ flex: "none", marginTop: 2 }} /><span>{why} {noKey && <Link className="link" href="/settings?tab=generate">Open Settings</Link>}</span></p>
              : !plan ? <Skeleton height={44} />
              : <>
                <p className="make-price">{money(plan.cost)}</p>
                <p className="field-hint" style={{ margin: 0 }}>{plan.say[0]!.toUpperCase() + plan.say.slice(1)}.</p>
                <p className="field-hint" style={{ margin: 0 }}>{each}{plan.provider === "openai" ? ` ${GEN_SOURCES.openai.name} charges by what it draws, so this is close, not exact.` : ""}</p>
              </>}
          </div>
          <hr />
          <p className="field-label" style={{ margin: 0 }}>Where it goes</p>
          <p className="field-hint" style={{ margin: 0 }}>Yarn{folder ? ` / ${folder.split("/").join(" / ")}` : ""}, named from what you said. You hear when it is in, in {kind === "video" ? "a few minutes" : "a minute or two"}.</p>
        </aside>
      </form>
    </Dialog>
  );
}
