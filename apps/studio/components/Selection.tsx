"use client";

// Picking several things in a list, as a file manager does: a box picks one, Shift picks everything
// between it and the last one picked, Ctrl or Cmd+A picks everything shown once one is picked, and
// Escape lets them all go. What is picked and no longer shown, moved away or filtered out, is let go.

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Field, Input } from "@knitted/ui";

export interface Selection<T> {
  picked: T[]; count: number; any: boolean;
  has: (id: string) => boolean;
  /** `range`: from the last one picked to this one, as Shift does. */
  toggle: (id: string, range?: boolean) => void;
  all: () => void; clear: () => void;
}

/** A click with Shift, Ctrl or Cmd held picks instead of opening. */
export const picking = (e: React.MouseEvent) => e.shiftKey || e.metaKey || e.ctrlKey;

export function useSelection<T extends { id: string }>(shown: T[]): Selection<T> {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const last = useRef<string | null>(null);
  const picked = useMemo(() => shown.filter((x) => ids.has(x.id)), [shown, ids]);
  const any = picked.length > 0;

  useEffect(() => {
    if (!any) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && ((el.tagName === "INPUT" && (el as HTMLInputElement).type !== "checkbox") || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing || document.querySelector("[role=dialog], [role=menu]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") { e.preventDefault(); setIds(new Set(shown.map((x) => x.id))); }
      else if (e.key === "Escape") { setIds(new Set()); last.current = null; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [any, shown]);

  return {
    picked, count: picked.length, any,
    has: (id) => ids.has(id),
    toggle: (id, range = false) => {
      const from = last.current ? shown.findIndex((x) => x.id === last.current) : -1;
      const to = shown.findIndex((x) => x.id === id);
      setIds((s) => {
        const n = new Set(s);
        if (range && from >= 0 && to >= 0) for (let i = Math.min(from, to); i <= Math.max(from, to); i++) n.add(shown[i].id);
        else if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
      last.current = id;
    },
    all: () => setIds(new Set(shown.map((x) => x.id))),
    clear: () => { setIds(new Set()); last.current = null; },
  };
}

/** The box on a card or a row. A click on it with Shift picks the range. */
export function PickBox({ sel, id, name, className, style }: { sel: Selection<unknown>; id: string; name: string; className?: string; style?: React.CSSProperties }) {
  return <input type="checkbox" className={className} aria-label={`Select ${name}`} checked={sel.has(id)} onChange={() => {}} onClick={(e) => sel.toggle(id, e.shiftKey)} style={style} />;
}

/** What can be done to everything picked, above the list it was picked from, and staying in sight as the list scrolls. */
export function SelectionBar({ sel, total, children }: { sel: Selection<unknown>; total: number; children: React.ReactNode }) {
  if (!sel.any) return null;
  return (
    <div role="toolbar" aria-label="Selection" className="selection-bar">
      <span className="label">{sel.count} selected</span>
      {children}
      {sel.count < total && <Button size="sm" variant="ghost" onClick={sel.all}>Select all {total}</Button>}
      <Button size="sm" variant="ghost" onClick={sel.clear}>Clear</Button>
      <span className="body-sm selection-hint">Shift-click picks a range. Ctrl+A picks them all. Esc lets go.</span>
    </div>
  );
}

/** A tag for everything picked. Not window.prompt: the app's window has none. */
export function TagDialog({ open, onOpenChange, what, onTag }: { open: boolean; onOpenChange: (o: boolean) => void; what: string; onTag: (tag: string) => Promise<void> }) {
  const [tag, setTag] = useState("");
  const [err, setErr] = useState<string | undefined>();
  const save = async () => {
    const t = tag.trim();
    if (!t) { setErr("Give it a tag."); return; }
    try { await onTag(t); setTag(""); setErr(undefined); onOpenChange(false); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Tag ${what}`} description="A word to find them by, like launch or winter."
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={save}>Add tag</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Tag" htmlFor="sel-tag" error={err}><Input id="sel-tag" autoFocus value={tag} maxLength={40} onChange={(e) => setTag(e.target.value)} /></Field>
      </form>
    </Dialog>
  );
}
