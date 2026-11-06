"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EASES, PRESETS, presetInfo, motionEnd, type Clip, type Ease, type Preset, type Stitch } from "@knitted/core";
import { Button, IconButton, Select, icons } from "@knitted/ui";
import { useEditor } from "@/lib/editor/store";
import { NumberField } from "./controls";

const { Play, Pause, Trash2 } = icons;
const EASE_OPTIONS = (Object.keys(EASES) as Ease[]).map((e) => ({ value: e, label: e.replace(/-/g, " ") }));
const PRESET_OPTIONS = PRESETS.map((p) => ({ value: p.id, label: p.label }));
const rid = () => `cl_${Math.random().toString(36).slice(2, 8)}`;
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${String(Math.floor((ms % 1000) / 100))}`;
const label = (s: Stitch) => s.slot ?? (s.kind === "text" ? (s.content ?? "text").replace(/\*/g, "").slice(0, 18) : s.kind);

/** Add a clip to a stitch at the playhead, extending the video if it would run past the end. */
export function addClip(stitchId: string, preset: Preset) {
  const st = useEditor.getState();
  const info = presetInfo(preset);
  const start = st.playhead;
  const clip: Clip = { id: rid(), preset, startMs: start, endMs: start + info.defaultMs, ease: info.ease };
  const existing = st.pattern.motion?.tracks[stitchId] ?? [];
  const cmds: import("@knitted/core").Command[] = [{ type: "setMotion", stitchId, clips: [...existing, clip] }];
  if (st.pattern.durationMs < clip.endMs + 500) cmds.push({ type: "setMeta", durationMs: Math.max(3000, clip.endMs + 800) });
  st.dispatch({ type: "batch", commands: cmds }, { label: `Animate: ${info.label}` });
  return clip.id;
}

/**
 * The timeline. The playhead is the ENGINE'S clock: scrubbing and playing call the
 * same `seek` the knit does, so what plays here is, frame for frame, what is knitted.
 */
export function Timeline() {
  const st = useEditor();
  const { pattern, playhead, playing } = st;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [sel, setSel] = useState<{ stitchId: string; clipId: string } | null>(null);
  const drag = useRef<{ kind: "move" | "l" | "r" | "scrub"; stitchId?: string; clipId?: string; x0: number; orig?: Clip } | null>(null);
  const total = Math.max(3000, pattern.durationMs, motionEnd(pattern.motion));
  const LABEL = 110;
  const track = Math.max(200, width - LABEL - 16);
  const px = track / total;

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // Playback: advance the clock from real time. The CLOCK is real, but each frame it shows is set, never waited for.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      const next = useEditor.getState().playhead + (now - last); last = now;
      const end = useEditor.getState().pattern.durationMs || total;
      if (next >= end) { st.setPlayhead(end); st.setPlaying(false); return; }
      st.setPlayhead(next); raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.code !== "Space" || (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "BUTTON" || el.isContentEditable))) return;
      e.preventDefault(); const s = useEditor.getState(); s.setPlaying(!s.playing);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows = useMemo(() => [...pattern.stitches].reverse(), [pattern.stitches]);
  const clipsOf = (id: string) => pattern.motion?.tracks[id] ?? [];
  const selClip = sel ? clipsOf(sel.stitchId).find((c) => c.id === sel.clipId) : undefined;
  const write = (stitchId: string, clips: Clip[], label: string) => {
    const end = Math.max(...clips.map((c) => c.endMs), 0);
    const cmds: import("@knitted/core").Command[] = [{ type: "setMotion", stitchId, clips }];
    if (end + 300 > pattern.durationMs) cmds.push({ type: "setMeta", durationMs: end + 700 });
    st.dispatch({ type: "batch", commands: cmds }, { label, coalesce: true });
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const rect = wrap.current!.getBoundingClientRect();
    if (d.kind === "scrub") { st.setPlayhead(Math.min(total, Math.max(0, (e.clientX - rect.left - LABEL - 8) / px))); return; }
    const dt = Math.round((e.clientX - d.x0) / px / 10) * 10;
    const o = d.orig!;
    const next = d.kind === "move" ? { ...o, startMs: Math.max(0, o.startMs + dt), endMs: Math.max(0, o.startMs + dt) + (o.endMs - o.startMs) }
      : d.kind === "l" ? { ...o, startMs: Math.min(o.endMs - 80, Math.max(0, o.startMs + dt)) } : { ...o, endMs: Math.max(o.startMs + 80, o.endMs + dt) };
    st.setDraft({ [`clip:${d.stitchId}`]: { content: JSON.stringify(next) } as never });
  };
  const onUp = () => {
    const d = drag.current; drag.current = null;
    if (!d || d.kind === "scrub") return;
    const draft = useEditor.getState().draft?.[`clip:${d.stitchId}`] as { content?: string } | undefined;
    st.setDraft(null);
    if (!draft?.content) return;
    const next = JSON.parse(draft.content) as Clip;
    write(d.stitchId!, clipsOf(d.stitchId!).map((c) => (c.id === next.id ? next : c)), "Move clip");
  };
  const liveClip = (stitchId: string, c: Clip): Clip => {
    const dr = st.draft?.[`clip:${stitchId}`] as { content?: string } | undefined;
    if (dr?.content) { const n = JSON.parse(dr.content) as Clip; if (n.id === c.id) return n; }
    return c;
  };

  return (
    <section aria-label="Timeline" ref={wrap} onPointerMove={onMove} onPointerUp={onUp} style={{ borderTop: "1px solid var(--line)", background: "var(--surface)", padding: "8px 8px 10px", maxHeight: 280, overflow: "auto", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <IconButton label={playing ? "Pause" : "Play"} shortcut="Space" hint={playing ? undefined : "Plays the pattern from the playhead, as it will be knitted."} onClick={() => { if (!playing && playhead >= (pattern.durationMs || total) - 20) st.setPlayhead(0); st.setPlaying(!playing); }}>{playing ? <Pause size={16} /> : <Play size={16} />}</IconButton>
        <span className="code" aria-label="Playhead time" style={{ minWidth: 56 }}>{fmt(playhead)}</span>
        <span className="body-sm" style={{ color: "var(--ink-muted)" }}>of</span>
        <div style={{ width: 120 }}><NumberField label="Len" value={pattern.durationMs} min={0} max={120000} step={100} suffix="ms" onCommit={(v) => st.dispatch({ type: "setMeta", durationMs: v }, { label: "Length", coalesce: true })} /></div>
        <Button size="sm" tip="Makes the pattern as long as its animations, and a moment more." onClick={() => st.dispatch({ type: "setMeta", durationMs: Math.max(1000, motionEnd(pattern.motion) + 600) }, { label: "Fit length" })}>Fit to clips</Button>
        <span className="body-sm" style={{ color: "var(--ink-muted)", flex: 1 }}>{pattern.durationMs === 0 ? "This pattern is a still. Add an animation to make it a video." : "What you see here is what gets knitted."}</span>
      </div>

      <div style={{ position: "relative", marginLeft: LABEL }} onPointerDown={(e) => { drag.current = { kind: "scrub", x0: e.clientX }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onMove(e); }}
        role="slider" aria-label="Scrub the timeline" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.round(playhead)} tabIndex={0}
        onKeyDown={(e) => { if (e.key === "ArrowRight") st.setPlayhead(Math.min(total, playhead + (e.shiftKey ? 1000 : 33))); if (e.key === "ArrowLeft") st.setPlayhead(Math.max(0, playhead - (e.shiftKey ? 1000 : 33))); }}>
        <div style={{ height: 22, borderBottom: "1px solid var(--line-strong)", position: "relative", cursor: "col-resize" }}>
          {Array.from({ length: Math.floor(total / 1000) + 1 }, (_, i) => <span key={i} className="code" style={{ position: "absolute", left: i * 1000 * px, top: 2, fontSize: 10, color: "var(--ink-muted)", borderLeft: "1px solid var(--line-strong)", paddingLeft: 3, height: 20 }}>{i}s</span>)}
        </div>
        <div aria-hidden style={{ position: "absolute", left: playhead * px, top: 0, bottom: 0, width: 2, background: "var(--ember)", pointerEvents: "none", zIndex: 3 }} />
      </div>

      <div style={{ display: "grid", gap: 2 }}>
        {rows.map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", height: 26 }}>
            <button onClick={() => st.select([s.id])} aria-label={`Select ${label(s)}`} className="body-sm" style={{ width: LABEL, textAlign: "left", background: "none", border: 0, cursor: "pointer", color: st.selection.includes(s.id) ? "var(--ember-ink)" : "var(--ink)", font: "inherit", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(s)}</button>
            <div style={{ position: "relative", flex: 1, height: 22, background: "var(--surface-sunken)", borderRadius: 4 }}>
              {clipsOf(s.id).map((raw) => {
                const c = liveClip(s.id, raw);
                const on = sel?.clipId === c.id;
                return (
                  <div key={c.id} role="button" tabIndex={0} aria-label={`${presetInfo(c.preset).label} on ${label(s)}, ${fmt(c.startMs)} to ${fmt(c.endMs)}`} aria-pressed={on}
                    onClick={() => setSel({ stitchId: s.id, clipId: c.id })} onKeyDown={(e) => { if (e.key === "Enter") setSel({ stitchId: s.id, clipId: c.id }); if (e.key === "Delete" || e.key === "Backspace") write(s.id, clipsOf(s.id).filter((x) => x.id !== c.id), "Delete clip"); }}
                    onPointerDown={(e) => { e.stopPropagation(); setSel({ stitchId: s.id, clipId: c.id }); drag.current = { kind: "move", stitchId: s.id, clipId: c.id, x0: e.clientX, orig: raw }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
                    style={{ position: "absolute", left: c.startMs * px, width: Math.max(8, (c.endMs - c.startMs) * px), top: 2, bottom: 2, background: on ? "var(--ember)" : "var(--tint)", border: "1px solid var(--ember)", borderRadius: 4, cursor: "grab", overflow: "hidden", color: on ? "var(--on-ember)" : "var(--ember-ink)", fontSize: 11, lineHeight: "18px", paddingLeft: 6, whiteSpace: "nowrap" }}>
                    {presetInfo(c.preset).label}
                    <span data-edge="l" onPointerDown={(e) => { e.stopPropagation(); drag.current = { kind: "l", stitchId: s.id, clipId: c.id, x0: e.clientX, orig: raw }; (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId); }} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize" }} />
                    <span data-edge="r" onPointerDown={(e) => { e.stopPropagation(); drag.current = { kind: "r", stitchId: s.id, clipId: c.id, x0: e.clientX, orig: raw }; (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId); }} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize" }} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {sel && selClip && (
        <div className="panel" role="group" aria-label="Clip" style={{ marginTop: 8, padding: 10, display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div style={{ width: 160 }}><Select aria-label="Animation" value={selClip.preset} onValueChange={(v) => write(sel.stitchId, clipsOf(sel.stitchId).map((c) => (c.id === sel.clipId ? { ...c, preset: v as Preset } : c)), "Change animation")} options={PRESET_OPTIONS} /></div>
          <div style={{ width: 140 }}><Select aria-label="Easing" value={selClip.ease ?? presetInfo(selClip.preset).ease} onValueChange={(v) => write(sel.stitchId, clipsOf(sel.stitchId).map((c) => (c.id === sel.clipId ? { ...c, ease: v as Ease } : c)), "Change easing")} options={EASE_OPTIONS} /></div>
          <div style={{ width: 120 }}><NumberField label="In" value={selClip.startMs} min={0} step={50} suffix="ms" onCommit={(v) => write(sel.stitchId, clipsOf(sel.stitchId).map((c) => (c.id === sel.clipId ? { ...c, startMs: Math.min(v, c.endMs - 50) } : c)), "Clip start")} /></div>
          <div style={{ width: 120 }}><NumberField label="Out" value={selClip.endMs} min={50} step={50} suffix="ms" onCommit={(v) => write(sel.stitchId, clipsOf(sel.stitchId).map((c) => (c.id === sel.clipId ? { ...c, endMs: Math.max(v, c.startMs + 50) } : c)), "Clip end")} /></div>
          <Button size="sm" variant="danger" onClick={() => { write(sel.stitchId, clipsOf(sel.stitchId).filter((c) => c.id !== sel.clipId), "Delete clip"); setSel(null); }}><Trash2 size={13} aria-hidden /> Delete clip</Button>
        </div>
      )}
    </section>
  );
}
