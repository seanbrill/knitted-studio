import * as React from "react";
import { cx } from "./cx.ts";

export function Chip({ children, tone, className }: { children: React.ReactNode; tone?: "ember"; className?: string }) {
  return <span className={cx("chip", tone === "ember" && "chip-ember", className)}>{children}</span>;
}

export function ToggleChip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="chip chip-button" aria-pressed={pressed} onClick={onClick}>{children}</button>;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** A pill with 3 to 5 overlapping 16px colour dots and the brand name. */
export function SwatchChip({ name, colors }: { name: string; colors: string[] }) {
  return (
    <span className="chip body-sm" style={{ gap: "var(--space-2)", padding: "4px 10px 4px 6px" }}>
      <span style={{ display: "inline-flex" }} aria-hidden>
        {colors.slice(0, 5).map((c, i) => (
          <span key={i} style={{ width: 16, height: 16, borderRadius: "50%", background: c, marginLeft: i === 0 ? 0 : -6, boxShadow: "0 0 0 1.5px var(--surface-raised)" }} />
        ))}
      </span>
      {name}
    </span>
  );
}

export function Skeleton({ width = "100%", height = 16 }: { width?: number | string; height?: number | string }) {
  return <div className="skeleton" style={{ width, height }} aria-hidden />;
}
