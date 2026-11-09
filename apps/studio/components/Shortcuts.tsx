"use client";

// Every key the studio answers to, in one list: where it works, what it does, and the keys,
// drawn the way this computer's keyboard has them (⌘ on a Mac, Ctrl elsewhere). ? opens it
// anywhere, and the editor's ⌘/ too. A key is only listed here once it works.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, icons } from "@knitted/ui";

const { Search } = icons;

/** A key, or a word like "click" when it starts with ~. "mod" is ⌘ on a Mac and Ctrl elsewhere. */
type Combo = string[];
type Row = { what: string; keys: Combo[]; or?: string };
type Group = { name: string; rows: Row[] };

export const GROUPS: Group[] = [
  { name: "Everywhere", rows: [
    { what: "This list", keys: [["?"]] },
    { what: "Close a window or a menu", keys: [["Esc"]] },
    { what: "Find anything, outside the editor", keys: [["mod", "K"]] },
  ] },
  { name: "In a list", rows: [
    { what: "Open", keys: [["Enter"]] },
    { what: "Pick, or pick a range", keys: [["mod", "~click"], ["shift", "~click"]] },
    { what: "Pick them all, once one is", keys: [["mod", "A"]] },
    { what: "Let go of them all", keys: [["Esc"]] },
    { what: "Move to folder", keys: [["M"]] },
    { what: "Add a tag, in Knits and Yarn", keys: [["T"]] },
    { what: "Favourite, in Knits", keys: [["F"]] },
    { what: "Rename, in Patterns and Yarn", keys: [["R"]] },
    { what: "Delete", keys: [["Delete"]] },
  ] },
  { name: "The editor", rows: [
    { what: "Undo, redo", keys: [["mod", "Z"], ["shift", "mod", "Z"]] },
    { what: "Select everything", keys: [["mod", "A"]] },
    { what: "Duplicate", keys: [["mod", "D"]] },
    { what: "Copy, paste", keys: [["mod", "C"], ["mod", "V"]] },
    { what: "Delete", keys: [["Delete"]] },
    { what: "Nudge 1px, 10px", keys: [["←"], ["shift", "←"]] },
    { what: "Forward, back", keys: [["mod", "]"], ["mod", "["]] },
    { what: "To the front, to the back", keys: [["shift", "mod", "]"], ["shift", "mod", "["]] },
    { what: "Edit text", keys: [["~double-click"]] },
    { what: "Add to the selection", keys: [["shift", "~click"]] },
    { what: "Keep proportions, resizing", keys: [["~hold", "shift"]] },
    { what: "Resize from the centre", keys: [["~hold", "alt"]] },
    { what: "Hide or show the side panels", keys: [["mod", "\\"]] },
    { what: "This list", keys: [["mod", "/"]] },
  ] },
  { name: "The canvas", rows: [
    { what: "Zoom in, out", keys: [["mod", "+"], ["mod", "-"]], or: "or + and - alone" },
    { what: "Fit, the selection, 100%", keys: [["shift", "1"], ["shift", "2"], ["shift", "0"]] },
    { what: "Zoom where the pointer is", keys: [["mod", "~scroll"]], or: "or pinch" },
    { what: "The hand, to move around", keys: [["H"]], or: "or hold Space" },
    { what: "Fit, from the space around it", keys: [["~double-click"]] },
  ] },
];

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** One key as this keyboard prints it. */
export function keyName(k: string, mac = isMac()): string {
  const MAC: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥", Enter: "↵", Delete: "⌫" };
  const PC: Record<string, string> = { mod: "Ctrl", shift: "Shift", alt: "Alt", Enter: "Enter", Delete: "Delete" };
  return (mac ? MAC : PC)[k] ?? k;
}

/** Keys as text, for a menu or a tooltip: "⌘/" on a Mac, "Ctrl+/" elsewhere. */
export const keyText = (combo: Combo, mac = isMac()) => combo.map((k) => keyName(k, mac)).join(mac ? "" : "+");

function Keys({ combo, mac }: { combo: Combo; mac: boolean }) {
  return <>{combo.map((k, i) => k.startsWith("~") ? <span key={i} className="keys-word">{k.slice(1)}</span> : <kbd key={i} className="kbd">{keyName(k, mac)}</kbd>)}</>;
}

/** The list, to read and to search. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState("");
  const [mac, setMac] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setQ(""); setMac(isMac()); }
  }, [open]);
  const want = q.trim().toLowerCase();
  const groups = useMemo(() => GROUPS.map((g) => ({ ...g, rows: g.rows.filter((r) => !want || `${g.name} ${r.what} ${r.or ?? ""}`.toLowerCase().includes(want)) })).filter((g) => g.rows.length), [want]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Keyboard shortcuts"
      description={<>{mac ? "On this Mac" : "On this computer"} · <kbd className="kbd">?</kbd> opens this anywhere</>}>
      <label className="move-find" style={{ marginBottom: "var(--space-4)" }}>
        <Search size={14} aria-hidden />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a shortcut" aria-label="Find a shortcut" />
      </label>
      {groups.length === 0 ? <p className="body-sm muted">No shortcut does that.</p> : (
        <div className="keys-groups">
          {groups.map((g) => (
            <section key={g.name} aria-label={g.name}>
              <h3 className="keys-head">{g.name}</h3>
              <dl className="keys-list">
                {g.rows.map((r) => (
                  <div key={r.what} className="keys-row">
                    <dt>{r.what}</dt>
                    <dd>{r.keys.map((c, i) => <span key={i} className="keys-combo">{i > 0 && <span className="keys-word">·</span>}<Keys combo={c} mac={mac} /></span>)}{r.or && <span className="keys-word">{r.or}</span>}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/** ? opens the list, wherever the person is, unless they are typing or something is open. */
export function useQuestionMark(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && el !== document.body && el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role=textbox]")) return;
      if (document.querySelector("[role=dialog], [role=menu]")) return;
      e.preventDefault(); onOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}

/** The list and its key, for a part of the app that has no other way to open it. */
export function ShortcutsHost() {
  const [open, setOpen] = useState(false);
  useQuestionMark(useCallback(() => setOpen(true), []));
  return <ShortcutsDialog open={open} onOpenChange={setOpen} />;
}
