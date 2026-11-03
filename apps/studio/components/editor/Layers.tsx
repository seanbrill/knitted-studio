"use client";

import { useState } from "react";
import { resolveStyle, type Stitch } from "@knitted/core";
import { icons } from "@knitted/ui";
import { useEditor } from "@/lib/editor/store";

const { Type, Image: ImageIcon, Shapes, Film, Music, Eye, EyeOff, Lock, Unlock, Package } = icons;
const KIND_ICON = { text: Type, image: ImageIcon, shape: Shapes, video: Film, audio: Music, part: Package } as const;

const label = (s: Stitch) => s.slot ?? (s.kind === "part" ? "part" : s.kind === "text" ? (s.content ?? "Text").replace(/\*/g, "").slice(0, 28) || "Text" : s.kind);

/** Top of the list is the front of the canvas, like every design tool. */
export function Layers() {
  const { pattern, swatch, selection, select, dispatch, mode } = useEditor();
  const [dragId, setDragId] = useState<string | null>(null);
  const rows = [...pattern.stitches].reverse();
  return (
    <ul aria-label="Layers" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
      {rows.length === 0 && <li className="body-sm" style={{ color: "var(--ink-muted)", padding: 8 }}>Nothing on the canvas yet.</li>}
      {rows.map((s, i) => {
        const Icon = KIND_ICON[s.kind];
        const hidden = !!resolveStyle(swatch, s.style).hidden;
        const on = selection.includes(s.id);
        const trueIndex = pattern.stitches.length - 1 - i;
        return (
          <li key={s.id} draggable={mode === "pattern"}
            onDragStart={() => setDragId(s.id)} onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragId && dragId !== s.id) dispatch({ type: "reorder", id: dragId, toIndex: trueIndex }, { label: "Reorder" }); setDragId(null); }}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", borderRadius: 6, background: on ? "var(--tint)" : "transparent", outline: on ? "1px solid var(--ember)" : undefined, opacity: hidden ? 0.5 : 1 }}>
            <button onClick={(e) => select([s.id], e.shiftKey)} aria-pressed={on} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "none", border: 0, padding: "4px 2px", cursor: "pointer", color: "var(--ink)", font: "inherit", fontSize: 13, textAlign: "left", minWidth: 0 }}>
              <Icon size={14} aria-hidden />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(s)}</span>
              {s.slot && <span className="code" style={{ color: "var(--ink-muted)" }}>{s.kind}</span>}
            </button>
            <button className="icon-btn" style={{ width: 24, height: 24 }} aria-label={hidden ? `Show ${label(s)}` : `Hide ${label(s)}`} onClick={() => dispatch({ type: "updateStitch", id: s.id, patch: { style: { ...(s.style ?? {}), hidden: hidden ? 0 : 1 } } }, { label: "Visibility" })}>{hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
            <button className="icon-btn" style={{ width: 24, height: 24, color: s.locked ? "var(--ember-ink)" : undefined }} aria-label={s.locked ? `Unlock ${label(s)}` : `Lock ${label(s)} to the pattern`} aria-pressed={s.locked} disabled={mode === "fill"} onClick={() => dispatch({ type: "setLocked", id: s.id, locked: !s.locked }, { label: s.locked ? "Unlock" : "Lock" })}>{s.locked ? <Lock size={13} /> : <Unlock size={13} />}</button>
          </li>
        );
      })}
    </ul>
  );
}
