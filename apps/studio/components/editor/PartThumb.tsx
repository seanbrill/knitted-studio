"use client";

import { useMemo } from "react";
import type { Part, Stitch, Swatch } from "@knitted/core";
import { pageFor } from "@knitted/render/pure";

/**
 * A Part drawn by the REAL renderer, in a tiny static frame. Not a sketch: what
 * the card shows is what the Part will look like in a pattern, in the active
 * swatch's colours and fonts.
 */
export function PartThumb({ part, swatch, projectId, width = 220 }: { part: Part; swatch: Swatch; projectId: string; width?: number }) {
  const W = 1000, H = Math.round(W / part.aspect);
  const doc = useMemo(() => {
    const inst: Stitch = { id: "i", kind: "part", x: 0, y: 0, w: 1, h: 1, locked: false, partId: part.id, overrides: {}, partSlots: part.slots };
    return pageFor({ id: "t", projectId: "", name: "", version: 1, updatedAt: "", durationMs: 0, size: { name: "t", w: W, h: H }, stitches: [inst] } as never,
      { swatch, mode: "edit", part: () => part, fontFaces: `@import url("/api/projects/${projectId}/fonts.css");` });
  }, [part, swatch, projectId, W, H]);
  const scale = width / W;
  return (
    <div aria-hidden style={{ width, height: H * scale, position: "relative", overflow: "hidden", borderRadius: 6, background: `repeating-conic-gradient(var(--surface-sunken) 0% 25%, var(--surface) 0% 50%) 0 0 / 14px 14px` }}>
      <iframe title="" srcDoc={doc} tabIndex={-1} style={{ width: W, height: H, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none", background: "transparent" }} />
    </div>
  );
}
