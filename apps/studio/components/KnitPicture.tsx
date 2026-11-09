"use client";

// A knit, small: a picture as itself, a video as its poster, the moment its pattern shows whole
// (api/knits/[kid]/poster). With `playing`, a video plays in its place, muted, from the start;
// where the person asked for less motion it stays still. With no poster (a video made before
// posters, where ffmpeg cannot make one), the video's first frame, as before.

import { useState, useSyncExternalStore, type CSSProperties } from "react";
import { knitFileUrl, knitPosterUrl } from "@knitted/core/client";

interface Knitish { id: string; kind: "image" | "video"; durationMs?: number | null }

// Less motion, as the person's system asks for it: then a video stays still where it is pointed at.
const REDUCE = "(prefers-reduced-motion: reduce)";
const onReduce = (f: () => void) => { const m = window.matchMedia(REDUCE); m.addEventListener("change", f); return () => m.removeEventListener("change", f); };

/** 8 s, 1:05: how long a video runs, as its badge says it. */
export const runTime = (ms: number) => { const s = Math.max(1, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function KnitPicture({ knit, playing = false, fit = "contain", badge = false, style }: { knit: Knitish; playing?: boolean; fit?: "contain" | "cover"; badge?: boolean; style?: CSSProperties }) {
  const [noPoster, setNoPoster] = useState(false);
  const [at, setAt] = useState(0);
  const still = useSyncExternalStore(onReduce, () => window.matchMedia(REDUCE).matches, () => false);
  const look: CSSProperties = { display: "block", width: "100%", height: "100%", objectFit: fit, ...style };
  if (knit.kind === "image") return <img src={knitFileUrl(knit)} alt="" loading="lazy" style={look} />;
  const play = playing && !still;
  return (
    <span className="knit-pic">
      {play
        ? <video src={knitFileUrl(knit)} poster={noPoster ? undefined : knitPosterUrl(knit)} autoPlay muted loop playsInline style={look} onLoadStart={() => setAt(0)} onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration) setAt(v.currentTime / v.duration); }} />
        : noPoster
          ? <video src={knitFileUrl(knit)} muted preload="metadata" style={look} />
          : <img src={knitPosterUrl(knit)} alt="" loading="lazy" style={look} onError={() => setNoPoster(true)} />}
      {badge && !play && knit.durationMs ? <span className="knit-pic-badge">▶ {runTime(knit.durationMs)}</span> : null}
      {play ? <span className="knit-pic-time"><span style={{ width: `${Math.round(at * 100)}%` }} /></span> : null}
    </span>
  );
}
