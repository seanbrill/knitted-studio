import type { Pattern } from "@knitted/core";

/**
 * A quick, dependency-free picture of a Pattern for cards and lists.
 *
 * Stitches are fractions, so this is just boxes in a box. It is a sketch, not a
 * render: the real thumbnail comes from the engine (Phase 6) and replaces this
 * wherever one exists. Until then a card is never blank.
 */
export function PatternPreview({ pattern, ratio }: { pattern: Pick<Pattern, "size" | "stitches">; ratio?: number }) {
  const aspect = ratio ?? pattern.size.w / pattern.size.h;
  return (
    <div
      aria-hidden
      style={{
        containerType: "inline-size",
        position: "relative",
        width: "100%",
        aspectRatio: String(aspect),
        background: "var(--surface-raised)",
        overflow: "hidden",
        borderRadius: "var(--radius-sm)",
      }}
    >
      {pattern.stitches.map((s) => {
        const fs = typeof s.style?.fontSize === "number" ? s.style.fontSize : 0.05;
        return (
          <div
            key={s.id}
            style={{
              position: "absolute",
              left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%`,
              overflow: "hidden",
              background: s.kind === "text" ? "transparent" : s.slot === "backdrop" ? "var(--tint)" : "var(--surface-sunken)",
              color: "var(--ink)",
              fontFamily: s.kind === "text" ? "var(--font-display)" : undefined,
              fontWeight: 800,
              fontSize: `${Math.max(fs * 100 * 0.9, 3)}cqw`,
              lineHeight: 1,
              letterSpacing: "-0.03em",
              border: s.locked ? "1px dashed var(--ember)" : s.kind === "text" ? "none" : "1px solid var(--line-strong)",
              borderRadius: 2,
            }}
          >
            {s.kind === "text" ? s.content : null}
          </div>
        );
      })}
    </div>
  );
}
