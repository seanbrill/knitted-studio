"use client";

// Zoom and pan, the same in the pattern editor and on a design sheet: the steps the buttons and
// keys go through, the keys (as Figma has them), and Space held to drag the view about.

import { useEffect, useState } from "react";

/** What the zoom buttons and keys step through: a quarter at most between two, finer near 100%. */
export const ZOOM_STEPS = [0.02, 0.03, 0.04, 0.05, 0.075, 0.1, 0.125, 0.15, 0.175, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.67, 0.75, 0.85, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];

/** The next step in or out from `now`, which may fall between two, kept from `min` to `max`. */
export function stepZoom(now: number, dir: 1 | -1, min = ZOOM_STEPS[0], max = ZOOM_STEPS[ZOOM_STEPS.length - 1]): number {
  const steps = ZOOM_STEPS.filter((z) => z >= min - 1e-9 && z <= max + 1e-9);
  const next = dir > 0 ? steps.find((z) => z > now * 1.001) : [...steps].reverse().find((z) => z < now * 0.999);
  return next ?? (dir > 0 ? max : min);
}

/** A wheel or a pinch, `dy` in pixels: a little zoom per event, however fast they come. */
export function wheelZoom(now: number, dy: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, now * Math.min(1.08, Math.max(1 / 1.08, Math.exp(-dy * 0.006)))));
}

export type ZoomKey = "in" | "out" | "fit" | "selection" | "actual" | "hand";

/**
 * What a key does to the view, or null. Ctrl or Cmd with plus or minus, or plus or minus alone,
 * zoom in and out; Ctrl or Cmd with 0, or Shift with 1, fits it; Shift with 2 zooms to what is
 * selected; Shift with 0 is 100%; H is the hand, to drag the view about.
 */
export function zoomKey(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): ZoomKey | null {
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  if (mod) return e.key === "=" || e.key === "+" ? "in" : e.key === "-" ? "out" : e.key === "0" ? "fit" : null;
  if (e.shiftKey && e.code === "Digit0") return "actual";
  if (e.shiftKey && e.code === "Digit1") return "fit";
  if (e.shiftKey && e.code === "Digit2") return "selection";
  if (e.key === "+" || e.key === "=") return "in";
  if (e.key === "-") return "out";
  if (!e.shiftKey && (e.key === "h" || e.key === "H")) return "hand";
  return null;
}

const TYPED = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role=slider], [role=textbox], [role=dialog], [role=menu], [role=listbox]";

/** Somewhere a key is typed, or a menu or list picks with it, so the zoom keys are its own. */
export function typingIn(t: EventTarget | null): boolean {
  const el = t instanceof HTMLElement ? t : null;
  return !!el && el !== document.body && !!el.closest(TYPED);
}

/** Somewhere Space types or presses something, so it is not for dragging the view. */
function spaceTaken(t: EventTarget | null): boolean {
  const el = t instanceof HTMLElement ? t : null;
  if (!el || el === document.body || el.closest("[data-pan-ok]")) return false;
  return !!el.closest(`${TYPED}, button, a[href], summary, [role=button], [role=checkbox], [role=radio], [role=switch], [role=tab]`);
}

/** Space held down outside anything that types or presses: while it is, a drag anywhere moves the view. */
export function useSpaceHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.ctrlKey || e.metaKey || e.altKey || spaceTaken(e.target)) return;
      e.preventDefault();
      if (!e.repeat) setHeld(true);
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setHeld(false); };
    const off = () => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", off);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", off); };
  }, []);
  return held;
}
