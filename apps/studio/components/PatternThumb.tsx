"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { colorFor, stillMs, type Part, type Pattern, type Swatch, type Yarn } from "@knitted/core";
import { yarnFileUrl, yarnPictureUrl, yarnThumbUrl } from "@knitted/core/client";
import { pageFor } from "@knitted/render/pure";

/** What a project's patterns are drawn with: its swatch, its Yarn and its Parts. */
export interface Look { swatch: Swatch; yarn: Yarn[]; parts: Part[] }

/**
 * The page's context as the editor's canvas builds it, but a picture is its 960-pixel copy
 * rather than the original: a card is small, and a grid of them would hold every original.
 */
export function thumbContext(projectId: string, { swatch, yarn, parts }: Look) {
  const yarnById = new Map(yarn.map((y) => [y.id, y]));
  const partById = new Map(parts.map((p) => [p.id, p]));
  return {
    swatch, mode: "edit" as const,
    yarn: (id: string) => {
      const y = yarnById.get(id);
      return y && !y.deletedAt ? { url: y.kind === "image" && y.meta.thumb ? yarnPictureUrl(y) : yarnFileUrl(y), kind: y.kind, mime: y.mime, width: y.width, height: y.height, meta: y.meta, posterUrl: y.meta.thumb ? yarnThumbUrl(y) : undefined } : undefined;
    },
    part: (id: string) => partById.get(id),
    fontFaces: `@import url("/api/projects/${projectId}/fonts.css");`,
  };
}
export type ThumbContext = ReturnType<typeof thumbContext>;

/**
 * A Pattern drawn by the real renderer, the one the editor and the engine use, in a still
 * frame as wide as its box. Not a sketch: the card shows the pattern as the editor draws
 * it, in the swatch's colours and fonts, with its pictures and parts. A video shows the
 * moment everything is in (stillMs), not its first frame, where most of it has yet to
 * enter. Until the swatch is in, the box only keeps its place.
 */
export function PatternThumb({ pattern, ctx }: { pattern: Pattern; ctx: ThumbContext | null }) {
  const { w: W, h: H } = pattern.size;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The same page for the same saved pattern and look: a list fetched again after a change
  // somewhere else hands over new objects, and only a pattern saved since is drawn again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doc = useMemo(() => (ctx ? pageFor(pattern, ctx) : null), [pattern.id, pattern.version, ctx]);
  const at = stillMs(pattern);
  return (
    <div ref={box} aria-hidden style={{ position: "relative", width: "100%", aspectRatio: `${W} / ${H}`, overflow: "hidden", borderRadius: "var(--radius-sm)", background: ctx ? colorFor(ctx.swatch, "background") : "var(--surface-raised)" }}>
      {doc && width > 0 && (
        <iframe title="" srcDoc={doc} tabIndex={-1}
          onLoad={(e) => { if (at) (e.currentTarget.contentWindow as (Window & { __stage?: { seek(ms: number): void } }) | null)?.__stage?.seek(at); }}
          style={{ position: "absolute", left: 0, top: 0, width: W, height: H, border: 0, transform: `scale(${width / W})`, transformOrigin: "0 0", pointerEvents: "none", background: "transparent" }} />
      )}
    </div>
  );
}
