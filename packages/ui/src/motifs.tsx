// The stitch chevron: the one motif that runs through the product.
//
// A V drawn with a thick stroke, stacked in columns like a knit swatch. The
// theme is specific about where it may appear: a divider, an empty state, the
// loading state, and a pattern on large ember fields in oxblood. Never wallpaper.

import * as React from "react";

export function StitchRow({ count = 6, size = 14, color = "currentColor", filled }: {
  count?: number; size?: number; color?: string; filled?: number;
}) {
  const done = filled ?? count;
  return (
    <span aria-hidden style={{ display: "inline-flex", gap: size * 0.35, alignItems: "center", color }}>
      {Array.from({ length: count }, (_, i) => (
        <svg key={i} width={size} height={size * 0.72} viewBox="0 0 10 7" fill="none"
          style={{ opacity: i < done ? 1 : 0.22, transition: "opacity var(--t-ui) var(--ease)" }}>
          <path d="M1 1L5 5.6L9 1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ))}
    </span>
  );
}

export function StitchDivider({ count = 7 }: { count?: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-6) 0", color: "var(--line-strong)" }}>
      <StitchRow count={count} size={16} />
    </div>
  );
}

/** Driven by real counts ("3 of 12 knitted"), never a timer: a spinner tied to nothing is a lie. */
export function StitchProgress({ total, done, label = "knitted" }: { total: number; done: number; label?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }} role="status" aria-live="polite">
      <span style={{ color: "var(--ember)" }}>
        <StitchRow count={Math.min(total, 12)} size={18} filled={Math.min(done, 12)} />
      </span>
      <span className="eyebrow">{done} of {total} {label}</span>
    </div>
  );
}

/** Two interlocking V chevrons on an ember tile. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="knitted">
      <rect width="32" height="32" rx="8" fill="var(--ember)" />
      <path d="M7 9.5L16 18L25 9.5" stroke="var(--on-ember)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M7 16L16 24.5L25 16" stroke="var(--oxblood)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** Type-only wordmark: "knitted" in Bricolage 800, ".studio" in mono at about 40%. */
export function Wordmark({ size = 20, color = "var(--ink)", muted = "var(--ink-muted)" }: { size?: number; color?: string; muted?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: size, letterSpacing: "-0.04em", color }}>knitted</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: size * 0.4, color: muted }}>.studio</span>
    </span>
  );
}
