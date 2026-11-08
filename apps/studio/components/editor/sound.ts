"use client";

import { useEffect } from "react";
import { yarnFileUrl } from "@knitted/core/client";
import { useEditor } from "@/lib/editor/store";

/** How far down music goes while a voice speaks, as the knit's mix does (12 dB). */
const DUCK = 0.25;

/**
 * The pattern's sounds, heard while the timeline plays: each voice line and track from where
 * the playhead is, from its in-point, looping if it loops, and music dipping under a voice.
 * A preview: the knit's mix also brings every file to one loudness first, so a quiet take
 * sounds quieter here than it will in the knit.
 */
export function useSoundPreview(on: boolean) {
  const playing = useEditor((s) => s.playing);
  useEffect(() => {
    if (!playing || !on) return;
    const st = useEditor.getState();
    const clips = (st.pattern.motion?.audio ?? []).filter((a) => st.yarn[a.yarnId]);
    if (!clips.length) return;
    const lengthOf = (a: (typeof clips)[number]) => Math.max(0, (st.yarn[a.yarnId].durationMs ?? 0) - (a.fromMs ?? 0));
    const sounds = clips.map((a) => {
      const el = new Audio(yarnFileUrl(st.yarn[a.yarnId]));
      el.preload = "auto";
      el.loop = !!a.loop;
      return { a, el };
    });
    // Where each one should be at a moment of the pattern, in seconds of its file, or null if silent then.
    const placeAt = (a: (typeof clips)[number], ms: number) => {
      const into = ms - a.startMs;
      if (into < 0) return null;
      const len = lengthOf(a), file = st.yarn[a.yarnId].durationMs ?? 0;
      if (!a.loop && len > 0 && into >= len) return null;
      const at = (a.fromMs ?? 0) + into;
      return (a.loop && file > 0 ? at % file : at) / 1000;
    };
    const tick = () => {
      const now = useEditor.getState().playhead;
      const speaking = sounds.some(({ a }) => a.kind === "voice" && placeAt(a, now) != null);
      for (const { a, el } of sounds) {
        const at = placeAt(a, now);
        if (at == null) { if (!el.paused) el.pause(); continue; }
        el.volume = Math.min(1, Math.max(0, (a.gain ?? 1) * (a.kind === "music" && speaking ? DUCK : 1)));
        // Back in step when it drifts, or when the playhead was moved while playing.
        if (Math.abs(el.currentTime - at) > 0.25) el.currentTime = at;
        if (el.paused) void el.play().catch(() => {});
      }
    };
    tick();
    const t = setInterval(tick, 100);
    return () => { clearInterval(t); for (const { el } of sounds) { el.pause(); el.removeAttribute("src"); el.load(); } };
  }, [playing, on]);
}
