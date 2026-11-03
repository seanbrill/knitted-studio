"use client";

// The editor: a 56px rail, a 300px inspector, the canvas between them, and a
// 48px top bar holding the file name, the brand swatch chip and the Knit
// button. Those sizes come from the theme document and are tokens, not guesses.
//
// ── WHY ONE COMPONENT AND NOT FIVE FILES ───────────────────────────────────
//
// The four regions share one selection and one Pattern, and at this size
// splitting them means threading the same two values through four prop
// interfaces plus a context. When the editor grows a real document model this
// becomes a store and the regions become files; today that would be structure
// for its own sake.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Pattern, Stitch, Swatch } from "@/lib/types";
import { SIZES } from "@/lib/types";
import { StitchProgress, Wordmark } from "./Stitch";

// ── The rail ────────────────────────────────────────────────────────────────

const TOOLS = [
  { id: "patterns", label: "Patterns", glyph: "▣" },
  { id: "yarn", label: "Yarn", glyph: "◳" },
  { id: "text", label: "Text", glyph: "T" },
  { id: "shapes", label: "Shapes", glyph: "◆" },
  { id: "swatch", label: "Swatch", glyph: "◉" },
] as const;

type ToolId = (typeof TOOLS)[number]["id"];

function Rail({ active, onPick }: { active: ToolId; onPick: (t: ToolId) => void }) {
  return (
    <nav
      aria-label="Tools"
      style={{
        width: "var(--rail-w)",
        background: "var(--surface)",
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: "var(--space-2)",
        gap: "var(--space-1)",
      }}
    >
      {TOOLS.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onPick(t.id)}
            title={t.label}
            aria-label={t.label}
            aria-pressed={on}
            style={{
              width: 40,
              height: 40,
              borderRadius: "var(--radius-md)",
              // The active tool is one of the few places ember is allowed
              // outside the canvas. It is a TINT with an ember glyph rather
              // than an ember fill, so the canvas stays the brightest thing
              // on screen.
              background: on ? "var(--tint)" : "transparent",
              color: on ? "var(--ember-ink)" : "var(--ink-muted)",
              border: on ? "1px solid var(--ember)" : "1px solid transparent",
              cursor: "pointer",
              fontSize: 16,
              transition: "all var(--t-ui) var(--ease)",
            }}
          >
            {t.glyph}
          </button>
        );
      })}
    </nav>
  );
}

// ── The swatch chip ─────────────────────────────────────────────────────────

export function SwatchChip({ swatch }: { swatch: Swatch }) {
  return (
    <span
      className="body-sm"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "4px 10px 4px 6px",
        borderRadius: "var(--radius-pill)",
        border: "1px solid var(--line-strong)",
        color: "var(--ink)",
      }}
    >
      <span style={{ display: "inline-flex" }}>
        {swatch.colors.slice(0, 5).map((c, i) => (
          <span
            key={i}
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: c,
              // Overlapping, per the spec. The ring is the chip's own ground
              // so the dots read as a stack rather than a smear.
              marginLeft: i === 0 ? 0 : -6,
              boxShadow: "0 0 0 1.5px var(--surface-raised)",
            }}
          />
        ))}
      </span>
      {swatch.name}
    </span>
  );
}

// ── The top bar ─────────────────────────────────────────────────────────────

function TopBar({
  name,
  swatch,
  knitting,
  onKnit,
}: {
  name: string;
  swatch: Swatch;
  knitting: boolean;
  onKnit: () => void;
}) {
  return (
    <header
      style={{
        height: "var(--topbar-h)",
        borderBottom: "1px solid var(--line)",
        background: "var(--surface)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "0 var(--space-4)",
        flexShrink: 0,
      }}
    >
      <Wordmark size={16} />
      <span style={{ color: "var(--line-strong)" }}>/</span>
      <span className="label">{name}</span>
      <div style={{ flex: 1 }} />
      <SwatchChip swatch={swatch} />
      {/* The one primary button on the screen. */}
      <button className="btn btn-primary" onClick={onKnit} disabled={knitting}>
        {knitting ? "Knitting..." : "Knit"}
      </button>
    </header>
  );
}

// ── The canvas ──────────────────────────────────────────────────────────────

function Canvas({
  pattern,
  selected,
  onSelect,
}: {
  pattern: Pattern;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  // The frame is laid out in fractions, so one set of coordinates serves every
  // output size. This is only how big it is DRAWN, and it is measured from the
  // real container rather than fixed: a 1080x1920 story against a hard 560px
  // cap left two thirds of a desktop canvas empty, with the work - the thing
  // the whole theme says should be the brightest object on screen - rendered
  // small in the middle of it.
  const [box, setBox] = useState({ w: 900, h: 600 });
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = useMemo(() => {
    // Leave room for the caption under the frame and the prompt bar over it.
    const usableH = Math.max(200, box.h - 128);
    const usableW = Math.max(200, box.w - 96);
    return Math.min(usableH / pattern.size.h, usableW / pattern.size.w);
  }, [pattern.size, box]);

  return (
    <div
      ref={wrap}
      onClick={() => onSelect(null)}
      style={{
        flex: 1,
        background: "var(--surface-sunken)",
        display: "grid",
        placeItems: "center",
        padding: "var(--space-8)",
        overflow: "auto",
      }}
    >
      <div>
        <div
          style={{
            position: "relative",
            width: pattern.size.w * scale,
            height: pattern.size.h * scale,
            background: "var(--surface-raised)",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
            boxShadow: "var(--shadow-lift)",
          }}
        >
          {pattern.stitches.map((s) => (
            <button
              key={s.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(s.id);
              }}
              className={s.locked ? "stitch-locked" : "stitch-free"}
              style={{
                position: "absolute",
                left: `${s.x * 100}%`,
                top: `${s.y * 100}%`,
                width: `${s.w * 100}%`,
                height: `${s.h * 100}%`,
                background: s.kind === "text" ? "transparent" : "var(--surface-sunken)",
                color: "var(--ink)",
                display: "flex",
                alignItems: "center",
                justifyContent: s.kind === "text" ? "flex-start" : "center",
                padding: 6,
                cursor: "pointer",
                font:
                  s.kind === "text"
                    ? `800 ${Math.max(10, 28 * scale)}px var(--font-display)`
                    : "inherit",
                outline: selected === s.id ? "2px solid var(--ember)" : "none",
                outlineOffset: 2,
                textAlign: "left",
                overflow: "hidden",
              }}
            >
              {s.kind === "text" ? s.content : <span className="eyebrow">{s.slot ?? s.kind}</span>}
            </button>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "var(--space-3)",
          }}
        >
          <span className="label">{pattern.name}</span>
          <span className="eyebrow">
            {pattern.size.name} · {pattern.size.w}x{pattern.size.h}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── The inspector ───────────────────────────────────────────────────────────

/** The slider from the reference images: 2px track, ember fill, 14px thumb. */
function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label style={{ display: "block", marginBottom: "var(--space-4)" }}>
      <span
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-2)",
        }}
      >
        <span className="body-sm" style={{ color: "var(--ink)" }}>
          {label}
        </span>
        {/* The value in its own sunken box, per the spec. */}
        <span
          className="code"
          style={{
            width: 44,
            textAlign: "center",
            padding: "2px 0",
            background: "var(--surface-sunken)",
            borderRadius: "var(--radius-sm)",
            color: "var(--ink-muted)",
          }}
        >
          {Math.round(value)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          height: 14,
          appearance: "none",
          background: `linear-gradient(to right, var(--ember) 0 ${pct}%, var(--line-strong) ${pct}% 100%)`,
          backgroundSize: "100% 2px",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "0 50%",
          cursor: "pointer",
        }}
      />
    </label>
  );
}

function Inspector({
  stitch,
  onChange,
}: {
  stitch: Stitch | null;
  onChange: (s: Stitch) => void;
}) {
  return (
    <aside
      style={{
        width: "var(--inspector-w)",
        background: "var(--surface-raised)",
        borderLeft: "1px solid var(--line)",
        padding: "var(--space-4)",
        overflowY: "auto",
        flexShrink: 0,
      }}
    >
      {!stitch ? (
        <>
          <p className="eyebrow">Nothing selected</p>
          <p className="body-sm" style={{ color: "var(--ink-muted)", marginTop: "var(--space-3)" }}>
            Pick a stitch on the canvas. Dashed outlines are locked by the
            pattern; solid ones are yours to change.
          </p>
        </>
      ) : (
        <>
          <p className="eyebrow">{stitch.slot ?? stitch.kind}</p>
          <h3 className="h3" style={{ margin: "var(--space-2) 0 var(--space-4)" }}>
            {stitch.kind === "text" ? "Text" : stitch.kind}
          </h3>

          {stitch.kind === "text" && (
            <textarea
              value={stitch.content ?? ""}
              onChange={(e) => onChange({ ...stitch, content: e.target.value })}
              disabled={stitch.locked}
              rows={3}
              style={{
                width: "100%",
                background: "var(--surface-sunken)",
                color: "var(--ink)",
                border: "1px solid var(--line-strong)",
                borderRadius: "var(--radius-sm)",
                padding: "var(--space-2)",
                font: "inherit",
                marginBottom: "var(--space-4)",
                resize: "vertical",
              }}
            />
          )}

          <Slider
            label="X"
            value={stitch.x * 100}
            onChange={(v) => onChange({ ...stitch, x: v / 100 })}
          />
          <Slider
            label="Y"
            value={stitch.y * 100}
            onChange={(v) => onChange({ ...stitch, y: v / 100 })}
          />
          <Slider
            label="Width"
            value={stitch.w * 100}
            onChange={(v) => onChange({ ...stitch, w: v / 100 })}
          />

          <button
            className="btn btn-secondary"
            style={{ width: "100%", marginTop: "var(--space-2)" }}
            onClick={() => onChange({ ...stitch, locked: !stitch.locked })}
          >
            {stitch.locked ? "Unlock for this knit" : "Lock to the pattern"}
          </button>
          <p className="body-sm" style={{ color: "var(--ink-muted)", marginTop: "var(--space-3)" }}>
            {stitch.locked
              ? "Locked stitches stay the same in every knit from this pattern."
              : "Free stitches can change each time this pattern is knitted."}
          </p>
        </>
      )}
    </aside>
  );
}

// ── The prompt bar ──────────────────────────────────────────────────────────

function PromptBar({ onSubmit, working }: { onSubmit: (s: string) => void; working: boolean }) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onSubmit(text.trim());
        setText("");
      }}
      className="floating"
      style={{
        position: "absolute",
        bottom: "var(--space-6)",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        width: "min(560px, calc(100% - var(--space-12)))",
        background: "var(--surface-raised)",
        border: "1px solid var(--line-strong)",
        borderRadius: "var(--radius-pill)",
        padding: "6px 6px 6px var(--space-4)",
        overflow: "hidden",
      }}
    >
      {/* The glow shimmer along the top edge while the model works. */}
      {working && (
        <span
          aria-hidden
          className="working"
          style={{ position: "absolute", inset: "0 0 auto 0", height: 2 }}
        />
      )}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Knit 12 posts from this pattern"
        aria-label="Ask your model"
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--ink)",
          font: "inherit",
        }}
      />
      <button className="btn btn-primary" style={{ height: 32, borderRadius: "var(--radius-pill)" }}>
        Send
      </button>
    </form>
  );
}

// ── The studio ──────────────────────────────────────────────────────────────

export function Studio({
  pattern: initial,
  swatch,
}: {
  pattern: Pattern;
  swatch: Swatch;
}) {
  const [pattern, setPattern] = useState(initial);
  const [tool, setTool] = useState<ToolId>("patterns");
  const [selected, setSelected] = useState<string | null>(null);
  const [knitting, setKnitting] = useState(false);
  const [done, setDone] = useState(0);

  const selectedStitch = pattern.stitches.find((s) => s.id === selected) ?? null;

  const updateStitch = useCallback((next: Stitch) => {
    setPattern((p) => ({
      ...p,
      stitches: p.stitches.map((s) => (s.id === next.id ? next : s)),
    }));
  }, []);

  const knit = useCallback(() => {
    // Placeholder for the engine call. The progress is driven by a real count
    // rather than a timer so that when the engine is wired in, the component
    // does not have to change shape: it already reports "3 of 12", not "busy".
    setKnitting(true);
    setDone(0);
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setDone(n);
      if (n >= 12) {
        clearInterval(id);
        setKnitting(false);
      }
    }, 180);
  }, []);

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <TopBar name={pattern.name} swatch={swatch} knitting={knitting} onKnit={knit} />
      <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
        <Rail active={tool} onPick={setTool} />
        <Canvas pattern={pattern} selected={selected} onSelect={setSelected} />
        <Inspector stitch={selectedStitch} onChange={updateStitch} />
        <PromptBar working={knitting} onSubmit={() => knit()} />
        {knitting && (
          <div
            className="panel floating"
            style={{
              position: "absolute",
              right: "calc(var(--inspector-w) + var(--space-6))",
              bottom: "var(--space-6)",
              padding: "var(--space-4)",
            }}
          >
            <StitchProgress total={12} done={done} />
          </div>
        )}
      </div>
    </div>
  );
}

export { SIZES };
