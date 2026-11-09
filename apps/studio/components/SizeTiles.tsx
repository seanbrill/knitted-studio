"use client";

// The sizes a pattern can be, as tiles: each drawn as its shape, with its numbers and where
// it goes, so the right one is found by eye. Custom opens a width and a height in place.

import { useEffect, useState } from "react";
import { SIZES, sizeNamed, type Size } from "@knitted/core";
import { Button, ChoiceCards, Dialog, Field, Input, icons } from "@knitted/ui";

const { Link2 } = icons;

/** Where each named size is used, in a few words. */
export const SIZE_USES: Record<string, string> = {
  Story: "Stories, Reels, TikTok, Shorts",
  Post: "Instagram and LinkedIn feeds",
  Square: "Every feed",
  Landscape: "YouTube, X, websites",
  Banner: "A wide picture for a page or an email",
};

export const MIN_SIDE = 16;
export const MAX_SIDE = 8000;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** "9:16 · 1080 × 1920", or only the pixels when the ratio is no help (1456 × 816). */
export function sizeLine(w: number, h: number) {
  const g = gcd(w, h); const rw = w / g; const rh = h / g;
  return `${rw <= 21 && rh <= 21 ? `${rw}:${rh} · ` : ""}${w} × ${h}`;
}

/** A size drawn to scale inside a 60 by 48 box. */
export function SizeShape({ w, h, box = [60, 48] }: { w: number; h: number; box?: [number, number] }) {
  const k = Math.min(box[0] / w, box[1] / h);
  return <span className="size-shape" style={{ width: Math.max(6, Math.round(w * k)), height: Math.max(6, Math.round(h * k)) }} />;
}

const sideOk = (v: string) => Number(v) >= MIN_SIDE && Number(v) <= MAX_SIDE;

/** Pick a size: the named ones, then Custom with its width and height. `value` is the size picked. */
export function SizeTiles({ value, onChange }: { value: Size; onChange: (s: Size) => void }) {
  const named = SIZES.find((s) => s.name === value.name && s.w === value.w && s.h === value.h);
  const [w, setW] = useState(String(value.w));
  const [h, setH] = useState(String(value.h));
  const custom = !named;
  const setSide = (nw: string, nh: string) => {
    setW(nw); setH(nh);
    onChange({ name: "Custom", w: sideOk(nw) ? Math.round(Number(nw)) : 0, h: sideOk(nh) ? Math.round(Number(nh)) : 0 });
  };
  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <ChoiceCards<string> label="Size" columns={3} value={named?.name ?? "Custom"}
        onChange={(v) => {
          const s = SIZES.find((x) => x.name === v);
          if (s) onChange(s); else setSide(w, h);
        }}
        options={[
          ...SIZES.map((s) => ({ value: s.name, title: s.name, meta: sizeLine(s.w, s.h), hint: SIZE_USES[s.name], art: <SizeShape w={s.w} h={s.h} /> })),
          { value: "Custom", title: "Custom", meta: "Any width and height", hint: `${MIN_SIDE} to ${MAX_SIDE} a side`, art: <span className="size-shape size-shape-custom">+</span>, dashed: true },
        ]} />
      {custom && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
          <Field label="Width" htmlFor="size-w"><Input id="size-w" mono inputMode="numeric" value={w} onChange={(e) => setSide(e.target.value, h)} aria-invalid={!sideOk(w) || undefined} /></Field>
          <Field label="Height" htmlFor="size-h" error={sideOk(w) && sideOk(h) ? undefined : `Use pixels between ${MIN_SIDE} and ${MAX_SIDE}.`}><Input id="size-h" mono inputMode="numeric" value={h} onChange={(e) => setSide(w, e.target.value)} aria-invalid={!sideOk(h) || undefined} /></Field>
        </div>
      )}
    </div>
  );
}

/** Whether a size from SizeTiles can be used: Custom with both sides in range. */
export const sizeReady = (s: Size) => s.w >= MIN_SIDE && s.h >= MIN_SIDE;

/** Sizes worth starting from that are not one of the named five, each true to where it goes. */
export const SIZE_PRESETS: { name: string; w: number; h: number; shape: string }[] = [
  { name: "Link preview", w: 1200, h: 628, shape: "the shape of a link preview on LinkedIn, X and Facebook" },
  { name: "YouTube thumbnail", w: 1280, h: 720, shape: "the shape of a YouTube thumbnail" },
  { name: "Pinterest", w: 1000, h: 1500, shape: "the shape of a Pinterest pin" },
  { name: "A4 at 150 dpi", w: 1240, h: 1754, shape: "the shape of an A4 page" },
];

/** "1.91:1, the shape of a link preview on LinkedIn, X and Facebook", or "4:5, the shape of a Post". */
export function shapeWords(w: number, h: number) {
  const g = gcd(w, h); const rw = w / g; const rh = h / g;
  const ratio = rw <= 21 && rh <= 21 ? `${rw}:${rh}` : w >= h ? `${(w / h).toFixed(2).replace(/\.?0+$/, "")}:1` : `1:${(h / w).toFixed(2).replace(/\.?0+$/, "")}`;
  const near = SIZE_PRESETS.find((p) => Math.abs(w * p.h - h * p.w) <= 0.01 * h * p.w);
  const named = sizeNamed(w, h);
  const what = named ? `the shape of a ${named}` : near?.shape ?? (w === h ? "square" : w > h ? "wider than tall" : "taller than wide");
  return `${ratio}, ${what}`;
}

/**
 * A pattern's size in pixels, any width and height: the two can keep their shape together,
 * the presets start from sizes that are used, and a picture shows the new size over the old.
 */
export function CustomSizeDialog({ open, onOpenChange, current, what, onApply }: {
  open: boolean; onOpenChange: (o: boolean) => void; current: Size; what: string; onApply: (s: Size) => void;
}) {
  const [w, setW] = useState(String(current.w));
  const [h, setH] = useState(String(current.h));
  const [linked, setLinked] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setW(String(current.w)); setH(String(current.h)); setLinked(false); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = sideOk(w) && sideOk(h);
  const nw = Math.round(Number(w)), nh = Math.round(Number(h));
  const ratio = Number(w) / Number(h) || current.w / current.h;
  const setSide = (side: "w" | "h", v: string) => {
    if (side === "w") { setW(v); if (linked && Number(v) > 0) setH(String(Math.round(Number(v) / ratio))); }
    else { setH(v); if (linked && Number(v) > 0) setW(String(Math.round(Number(v) * ratio))); }
  };
  const from = sizeNamed(current.w, current.h);
  // The old size and the new one drawn to one scale, in a 180 by 140 box.
  const k = Math.min(180 / Math.max(current.w, ok ? nw : 1), 140 / Math.max(current.h, ok ? nh : 1));
  const same = ok && nw === current.w && nh === current.h;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Custom size" description={`For ${what}, from ${from ? `${from} ` : ""}${current.w} × ${current.h}`}
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={!ok || same} onClick={() => { onApply({ name: "Custom", w: nw, h: nh }); onOpenChange(false); }}>{ok ? `Make it ${nw} × ${nh}` : "Make it this size"}</Button></>}>
      <form className="custom-size" onSubmit={(e) => { e.preventDefault(); if (ok && !same) { onApply({ name: "Custom", w: nw, h: nh }); onOpenChange(false); } }}>
        <div style={{ display: "grid", gap: "var(--space-3)", alignContent: "start" }}>
          <div className="custom-size-sides">
            <Field label="Width" htmlFor="cs-w"><span className="input-unit"><Input id="cs-w" mono autoFocus inputMode="numeric" value={w} onChange={(e) => setSide("w", e.target.value)} aria-invalid={!sideOk(w) || undefined} /><span aria-hidden>px</span></span></Field>
            <button type="button" className="icon-btn custom-size-link" aria-pressed={linked} aria-label="Keep the shape" title={linked ? "The width and height change together" : "Change them together, keeping the shape"} onClick={() => setLinked(!linked)}><Link2 size={15} aria-hidden /></button>
            <Field label="Height" htmlFor="cs-h"><span className="input-unit"><Input id="cs-h" mono inputMode="numeric" value={h} onChange={(e) => setSide("h", e.target.value)} aria-invalid={!sideOk(h) || undefined} /><span aria-hidden>px</span></span></Field>
          </div>
          {ok ? <p className="field-hint" style={{ margin: 0 }}>{shapeWords(nw, nh)}. From {MIN_SIDE} to {MAX_SIDE} a side.</p>
            : <p className="field-error" role="alert" style={{ margin: 0 }}>Use pixels between {MIN_SIDE} and {MAX_SIDE}.</p>}
          <div className="field" style={{ marginTop: "var(--space-2)" }}>
            <span className="field-label">Or start from</span>
            <div className="tag-chips">
              {SIZE_PRESETS.map((p) => <button key={p.name} type="button" className="tag-offer" aria-pressed={nw === p.w && nh === p.h} onClick={() => { setW(String(p.w)); setH(String(p.h)); }}>{p.name} <span className="tag-chip-n">{p.w} × {p.h}</span></button>)}
            </div>
          </div>
        </div>
        <figure className="custom-size-preview" aria-label={ok ? `The new size, ${nw} by ${nh}, over the old one, ${current.w} by ${current.h}` : undefined}>
          <div className="custom-size-stage">
            <span className="custom-size-old" style={{ width: current.w * k, height: current.h * k }} />
            {ok && <span className="custom-size-new" style={{ width: nw * k, height: nh * k }}>{nw} × {nh}</span>}
          </div>
          <figcaption>The stitches keep their places in proportion. Check the ones near the edges.</figcaption>
        </figure>
      </form>
    </Dialog>
  );
}
