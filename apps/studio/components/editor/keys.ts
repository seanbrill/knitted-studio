"use client";

import { useEffect } from "react";
import { useEditor } from "@/lib/editor/store";
import type { Command, Stitch } from "@knitted/core";

let clipboard: Stitch[] = [];
const rid = () => `st_${Math.random().toString(36).slice(2, 9)}`;

/** Duplicate stitches, offset slightly, with fresh ids and no slot names (a slot is unique in a pattern). */
export function duplicateStitches(src: Stitch[], offset = 0.02): Command {
  return { type: "batch", commands: src.map((s) => ({ type: "addStitch" as const, stitch: { ...s, id: rid(), slot: undefined, locked: false, x: Math.min(0.95, s.x + offset), y: Math.min(0.95, s.y + offset) } })) };
}

export function useEditorKeys({ onShortcuts, onFit }: { onShortcuts: () => void; onFit: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable || el.closest("[role=dialog]"))) return;
      const st = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const sel = st.pattern.stitches.filter((s) => st.selection.includes(s.id));
      const W = st.pattern.size.w, H = st.pattern.size.h;
      const key = e.key.toLowerCase();

      if (mod && key === "z") { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return; }
      if (mod && key === "y") { e.preventDefault(); st.redo(); return; }
      if (mod && key === "a") { e.preventDefault(); st.select(st.pattern.stitches.filter((s) => !(st.mode === "fill" && s.locked)).map((s) => s.id)); return; }
      if (mod && key === "d" && sel.length) { e.preventDefault(); st.dispatch(duplicateStitches(sel), { label: "Duplicate" }); return; }
      if (mod && key === "c" && sel.length) { clipboard = sel.map((s) => ({ ...s })); return; }
      if (mod && key === "v" && clipboard.length) { e.preventDefault(); st.dispatch(duplicateStitches(clipboard, 0.03), { label: "Paste" }); return; }
      if (mod && key === "0") { e.preventDefault(); onFit(); return; }
      if (mod && (key === "=" || key === "+")) { e.preventDefault(); st.setZoom(Math.min(4, (st.zoom === "fit" ? 0.4 : st.zoom) * 1.25)); return; }
      if (mod && key === "-") { e.preventDefault(); st.setZoom(Math.max(0.1, (st.zoom === "fit" ? 0.4 : st.zoom) / 1.25)); return; }
      if (mod && key === "/") { e.preventDefault(); onShortcuts(); return; }
      if (mod && (key === "]" || key === "[") && sel.length === 1) {
        e.preventDefault();
        const i = st.pattern.stitches.findIndex((s) => s.id === sel[0].id);
        const to = e.shiftKey ? (key === "]" ? st.pattern.stitches.length - 1 : 0) : i + (key === "]" ? 1 : -1);
        st.dispatch({ type: "reorder", id: sel[0].id, toIndex: to }, { label: "Reorder" }); return;
      }
      if (!sel.length) { if (key === "escape") st.select([]); return; }
      if (key === "escape") { st.select([]); return; }
      if (key === "delete" || key === "backspace") { e.preventDefault(); st.dispatch({ type: "batch", commands: sel.map((s) => ({ type: "removeStitch" as const, id: s.id })) }, { label: "Delete" }); return; }
      if (key.startsWith("arrow")) {
        // A slider (the timeline's scrub bar, the Inspector's) moves itself with the arrows, not the selection.
        if (el?.closest("[role=slider]")) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        st.dispatch({ type: "batch", commands: sel.map((s) => ({ type: "updateStitch" as const, id: s.id, patch: { x: Math.round((s.x + dx / W) * 1e5) / 1e5, y: Math.round((s.y + dy / H) * 1e5) / 1e5 } })) }, { label: "Nudge", coalesce: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onShortcuts, onFit]);
}

export const SHORTCUTS: [string, string][] = [
  ["Undo / redo", "Ctrl or Cmd + Z / Shift + Z"], ["Select all", "Ctrl or Cmd + A"], ["Duplicate", "Ctrl or Cmd + D"], ["Copy / paste", "Ctrl or Cmd + C / V"],
  ["Delete", "Delete or Backspace"], ["Nudge 1px / 10px", "Arrow keys / Shift + arrows"], ["Bring forward / back", "Ctrl or Cmd + ] / ["], ["To front / back", "Ctrl or Cmd + Shift + ] / ["],
  ["Edit text", "Double-click"], ["Add to selection", "Shift + click"], ["Keep proportions", "Shift while resizing"], ["Resize from centre", "Alt while resizing"], ["Zoom", "Ctrl or Cmd + plus / minus, 0 to fit"], ["This list", "Ctrl or Cmd + /"],
];
