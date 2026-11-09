"use client";

import { useEffect, useRef } from "react";

/**
 * A short knit that plays, without sound, while it is on screen, and stops when it is not.
 * With reduced motion it never starts by itself: it shows its poster and the player's controls.
 */
export function LoopVideo({ src, poster, width, height, label }: { src: string; poster: string; width: number; height: number; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) { v.controls = true; return; }
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) v.play().catch(() => { v.controls = true; }); else v.pause(); }, { threshold: 0.4 });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return <video ref={ref} src={src} poster={poster} width={width} height={height} muted loop playsInline preload="none" aria-label={label} />;
}
