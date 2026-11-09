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

// Lines of a few lengths, so a page of skeletons does not look like a grid of one bar.
const LINE = ["62%", "48%", "70%", "55%", "66%", "44%"];
const line = (i: number, short = false) => short ? `${Math.round(parseInt(LINE[i % LINE.length]) * 0.6)}%` : LINE[i % LINE.length];

/** Folder tiles, waiting: the height of the tiles that come, so nothing moves when they do. */
export function SkeletonTiles({ count = 3 }: { count?: number }) {
  return (
    <div className="sk-tiles" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk-tile">
          <div className="skeleton" style={{ width: 20, height: 18, flexShrink: 0 }} />
          <div style={{ flex: 1, display: "grid", gap: 6 }}><div className="skeleton" style={{ width: line(i), height: 10 }} /><div className="skeleton" style={{ width: line(i + 2, true), height: 8 }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Cards, waiting: a picture of the shape that comes, and its name and facts under it. */
export function SkeletonCards({ count = 8, min = 200, ratio = "4 / 5", lines = 2 }: { count?: number; min?: number; ratio?: string; lines?: number }) {
  return (
    <div className="sk-cards" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk-card">
          <div className="skeleton" style={{ aspectRatio: ratio, borderRadius: "var(--radius-sm)" }} />
          {Array.from({ length: lines }, (_, n) => <div key={n} className="skeleton" style={{ width: line(i + n, n > 0), height: n ? 8 : 10 }} />)}
        </div>
      ))}
    </div>
  );
}

/** Rows of a list, waiting: a small picture and two lines each. */
export function SkeletonRows({ count = 5, picture = true }: { count?: number; picture?: boolean }) {
  return (
    <div className="sk-rows" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk-row">
          {picture && <div className="skeleton" style={{ width: 40, height: 40, flexShrink: 0 }} />}
          <div style={{ flex: 1, display: "grid", gap: 6 }}><div className="skeleton" style={{ width: line(i), height: 10 }} /><div className="skeleton" style={{ width: line(i + 3, true), height: 8 }} /></div>
        </div>
      ))}
    </div>
  );
}

/** A row of filters, waiting: a search and a few choices, the height of the real ones. */
export function SkeletonFilters() {
  return (
    <div aria-hidden style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
      {[220, 164, 150, 150, 130, 170].map((w, i) => <div key={i} className="skeleton" style={{ width: w, height: 36 }} />)}
    </div>
  );
}

/** A whole section, waiting: its filters, its folder tiles and then its cards, at their real sizes. */
export function SkeletonSection({ filters, tiles = 3, cards = 8, min, ratio, list }: { filters?: boolean; tiles?: number; cards?: number; min?: number; ratio?: string; list?: boolean }) {
  return (
    <div role="status" aria-label="Loading">
      {filters && <SkeletonFilters />}
      {tiles > 0 && <SkeletonTiles count={tiles} />}
      {list ? <SkeletonRows count={Math.min(cards, 6)} /> : <SkeletonCards count={cards} min={min} ratio={ratio} />}
    </div>
  );
}
