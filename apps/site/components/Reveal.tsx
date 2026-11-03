"use client";

import { useEffect, useRef } from "react";

/**
 * Stitching in: content reveals top to bottom, like rows being knit, as it
 * scrolls into view. Without JS it is simply visible. With reduced motion it
 * is not animated at all (the global rule also zeroes the animation).
 */
export function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight) return; // already on screen: leave it alone
    el.classList.add("reveal-pending");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.remove("reveal-pending");
          el.classList.add("stitching-in");
          io.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}
