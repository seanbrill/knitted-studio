// The stitch chevron: the one motif that runs through the product.
//
// A V drawn with a thick stroke, stacked in columns like a knit swatch. The
// theme document is specific about where it may appear - a divider, an empty
// state, the loading state, and as a pattern on large ember fields in oxblood -
// and equally specific that it is never decorative wallpaper.
//
// So it is a component with named uses rather than a free-floating graphic.
// If a new use is needed, it gets a name here and the reason gets written
// down, which is the cheapest guard against it spreading.

export function StitchRow({
  count = 6,
  size = 14,
  color = "currentColor",
  filled,
}: {
  count?: number;
  size?: number;
  color?: string;
  /** How many Vs are "done", for the loading state. Undefined means all. */
  filled?: number;
}) {
  const vs = Array.from({ length: count }, (_, i) => i);
  const done = filled ?? count;
  return (
    <span
      aria-hidden
      style={{ display: "inline-flex", gap: size * 0.35, alignItems: "center", color }}
    >
      {vs.map((i) => (
        <svg
          key={i}
          width={size}
          height={size * 0.72}
          viewBox="0 0 10 7"
          fill="none"
          style={{
            opacity: i < done ? 1 : 0.22,
            transition: "opacity var(--t-ui) var(--ease)",
          }}
        >
          <path
            d="M1 1L5 5.6L9 1"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </span>
  );
}

/**
 * A divider: a single row of 5-8 Vs, muted.
 */
export function StitchDivider({ count = 7 }: { count?: number }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        padding: "var(--space-6) 0",
        color: "var(--line-strong)",
      }}
    >
      <StitchRow count={count} size={16} />
    </div>
  );
}

/**
 * The loading state: Vs filling in one by one.
 *
 * Driven by a `step` the caller advances, not by an internal timer, so it can
 * reflect real progress - 3 of 12 posts knitted - instead of pretending.
 * A spinner that is not tied to anything is a lie with a nice animation.
 */
export function StitchProgress({ total, done }: { total: number; done: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <span style={{ color: "var(--ember)" }}>
        <StitchRow count={Math.min(total, 12)} size={18} filled={Math.min(done, 12)} />
      </span>
      <span className="eyebrow">
        {done} of {total} knitted
      </span>
    </div>
  );
}

/**
 * The logo. Type-only, as the theme document instructs until logo files exist:
 * "knitted" in lowercase Bricolage 800, ".studio" in mono at about 40% in
 * ink-muted.
 */
export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: size,
          letterSpacing: "-0.04em",
          color: "var(--ink)",
        }}
      >
        knitted
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: size * 0.4,
          color: "var(--ink-muted)",
        }}
      >
        .studio
      </span>
    </span>
  );
}
