"use client";

// The zoom in a bar, the same in the pattern editor and on a design sheet: the hand, out, a menu
// of zooms with their keys, and in.

import { IconButton, Menu, icons } from "@knitted/ui";
import { keyText } from "./Shortcuts";

const { ZoomIn, ZoomOut, ChevronDown, Hand } = icons;

export function ZoomControls({ zoom, scale, onZoom, onStep, onSelection, selectionHint, hand, onHand }: {
  zoom: number | "fit";
  /** The zoom shown now: the fit's, when it fits. */
  scale: number;
  onZoom: (z: number | "fit") => void;
  onStep: (dir: 1 | -1) => void;
  /** Zoom to what is selected; none while nothing is. */
  onSelection?: () => void;
  selectionHint?: string;
  hand: boolean;
  onHand: (on: boolean) => void;
}) {
  const pct = `${Math.round(scale * 100)}%`;
  return (
    <>
      <span className="editor-wide"><IconButton label="Hand" shortcut="H, or hold Space" hint="Drag anywhere to move around. Scrolling and the middle button move it too." pressed={hand} onClick={() => onHand(!hand)}><Hand size={16} /></IconButton></span>
      <span className="editor-wide"><IconButton label="Zoom out" shortcut={keyText(["mod", "-"])} hint="Or pinch, or hold Ctrl and scroll." onClick={() => onStep(-1)}><ZoomOut size={16} /></IconButton></span>
      <Menu align="center" trigger={
        <button type="button" className="chip chip-button" aria-label={`Zoom: ${zoom === "fit" ? `fit to screen, ${pct}` : pct}`} style={{ minWidth: 64, justifyContent: "center", gap: 2 }}>
          {zoom === "fit" ? "Fit" : pct}<ChevronDown size={12} aria-hidden />
        </button>
      } items={[
        { label: "Zoom in", shortcut: "Ctrl +", onSelect: () => onStep(1) },
        { label: "Zoom out", shortcut: "Ctrl -", onSelect: () => onStep(-1) },
        "separator",
        { label: "Fit to screen", shortcut: "Shift 1", onSelect: () => onZoom("fit") },
        { label: onSelection ? "Zoom to selection" : selectionHint ?? "Zoom to selection", shortcut: "Shift 2", disabled: !onSelection, onSelect: () => onSelection?.() },
        "separator",
        { label: "50%", onSelect: () => onZoom(0.5) },
        { label: "100%", shortcut: "Shift 0", onSelect: () => onZoom(1) },
        { label: "200%", onSelect: () => onZoom(2) },
      ]} />
      <span className="editor-wide"><IconButton label="Zoom in" shortcut={keyText(["mod", "+"])} hint="Or pinch, or hold Ctrl and scroll." onClick={() => onStep(1)}><ZoomIn size={16} /></IconButton></span>
    </>
  );
}
