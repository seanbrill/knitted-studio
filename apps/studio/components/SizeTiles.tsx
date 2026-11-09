"use client";

// The sizes a pattern can be, as tiles: each drawn as its shape, with its numbers and where
// it goes, so the right one is found by eye. Custom opens a width and a height in place.

import { useState } from "react";
import { SIZES, type Size } from "@knitted/core";
import { ChoiceCards, Field, Input } from "@knitted/ui";

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
