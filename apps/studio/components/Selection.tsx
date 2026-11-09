"use client";

// Picking several things in a list, as a file manager does: a box picks one, Shift picks everything
// between it and the last one picked, Ctrl or Cmd+A picks everything shown once one is picked, and
// Escape lets them all go. What is picked and no longer shown, moved away or filtered out, is let go.

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Input, icons } from "@knitted/ui";

const { Plus, X } = icons;

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
    // Before anything else hears it: a menu closes on Esc, and is gone by the time the key reaches
    // the window, so Esc that closes a menu would let go of what is picked too.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
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

type ListAct = "move" | "tag" | "favourite" | "rename" | "delete";
const LIST_KEYS: Record<string, ListAct> = { m: "move", t: "tag", f: "favourite", r: "rename", Delete: "delete", Backspace: "delete" };

/**
 * The keys a list answers to: M moves, T tags, F favourites, R renames and Delete deletes,
 * on the thing with the focus (each one's element carries data-thing with its id) or, when
 * that is one of several picked or nothing has the focus, on everything picked. Each list
 * gives the ones it has; R works on one only.
 */
export function useListKeys<T extends { id: string }>(items: T[], sel: Selection<T>, on: Partial<Record<ListAct, (them: T[]) => void>>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
      const act = LIST_KEYS[e.key];
      const fn = act && on[act];
      if (!fn) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== document.body && el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role=textbox]")) return;
      if (document.querySelector("[role=dialog], [role=menu]")) return;
      const id = el?.closest<HTMLElement>("[data-thing]")?.dataset.thing;
      const one = id ? items.find((x) => x.id === id) : undefined;
      const them = one ? (sel.has(one.id) && sel.count > 1 ? sel.picked : [one]) : sel.picked;
      if (!them.length || (act === "rename" && them.length !== 1)) return;
      e.preventDefault(); fn(them);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, sel, on]);
}

/** "Tagged launch and winter", "Took hero off", or both. */
export const tagWords = (added: string[], removed: string[]) => {
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");
  return [added.length && `Tagged ${list(added)}`, removed.length && `${added.length ? "took" : "Took"} ${list(removed)} off`].filter(Boolean).join(", ");
};

/**
 * Tags for everything picked, many at once. A tag all of them have comes off with its x; one
 * some have goes on the rest with its +. Adding, the project's own tags come first, the most
 * used at the top, so one word does not become three: Enter adds the one lit, a comma adds
 * what is typed. Nothing changes until the button. Not window.prompt: the app's window has none.
 */
export function TagDialog({ open, onOpenChange, what, where, items, known, pics, onSave, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  /** What is tagged, like "3 files"; `where`, the section, like "Yarn". */
  what: string; where: string;
  items: { id: string; tags: string[] }[];
  /** The tags of everything in the section, for what to suggest. */
  known: string[][];
  /** Up to three small pictures of what is tagged. */
  pics?: string[];
  /** Saves one thing's tags; the dialog works out each one's. */
  onSave: (id: string, tags: string[]) => Promise<void>;
  /** After everything is saved, with what was added and taken off. */
  onDone?: (added: string[], removed: string[]) => void | Promise<void>;
}) {
  const [adds, setAdds] = useState<string[]>([]);
  const [removes, setRemoves] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [lit, setLit] = useState(-1);
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setAdds([]); setRemoves(new Set()); setText(""); setLit(-1); setErr(undefined); setBusy(false); }
  }, [open]);
  const n = items.length;
  const have = useMemo(() => { const m = new Map<string, number>(); for (const it of items) for (const t of new Set(it.tags)) m.set(t, (m.get(t) ?? 0) + 1); return m; }, [items]);
  const ranked = useMemo(() => {
    const m = new Map<string, number>();
    for (const ts of known) for (const t of new Set(ts)) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { sensitivity: "base" }));
  }, [known]);
  const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
  const onAll = (t: string) => adds.some((a) => same(a, t)) || (have.get(t) === n && !removes.has(t));
  const typed = text.trim().replace(/,+$/, "").trim().slice(0, 40);
  const q = typed.toLowerCase();
  const offers = ranked.filter(([t]) => !onAll(t) && (!q || t.toLowerCase().includes(q))).slice(0, 6);
  const exact = !!typed && (ranked.some(([t]) => same(t, typed)) || adds.some((a) => same(a, typed)));
  const choices: { tag: string; count?: number; fresh?: boolean }[] = [...offers.map(([tag, count]) => ({ tag, count })), ...(typed && !exact ? [{ tag: typed, fresh: true }] : [])];
  // Typing lights the first choice; with nothing typed, only the arrows light one.
  const at = !choices.length ? -1 : typed ? Math.min(Math.max(lit, 0), choices.length - 1) : Math.min(lit, choices.length - 1);
  const resolve = (t: string) => ranked.find(([k]) => same(k, t))?.[0] ?? t;
  const add = (t: string) => {
    const tag = resolve(t);
    if (removes.has(tag)) { setRemoves((r) => { const x = new Set(r); x.delete(tag); return x; }); }
    if (have.get(tag) !== n && !adds.some((a) => same(a, tag))) setAdds((a) => [...a, tag]);
    setText(""); setLit(-1); setErr(undefined);
  };
  const drop = (t: string) => {
    if (adds.includes(t)) setAdds((a) => a.filter((x) => x !== t));
    if (have.has(t)) setRemoves((r) => new Set(r).add(t));
  };
  const keep = (t: string) => setRemoves((r) => { const x = new Set(r); x.delete(t); return x; });
  const changes = adds.length + removes.size;
  /** What is typed and not added yet goes on too: the button means what it says. */
  const save = async () => {
    const more = typed && !adds.some((a) => same(a, typed)) ? [resolve(typed)] : [];
    const adding = [...adds, ...more];
    if (!adding.length && !removes.size) { setErr("Add a tag, or take one off."); return; }
    setBusy(true);
    try {
      for (const it of items) {
        const next = [...it.tags.filter((t) => !removes.has(t)), ...adding.filter((a) => !it.tags.some((t) => same(t, a)))];
        if (next.length !== it.tags.length || next.some((t, i) => t !== it.tags[i])) await onSave(it.id, next);
      }
      await onDone?.(adding, [...removes]);
      onOpenChange(false);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const shown = [...new Set([...have.keys(), ...adds])].sort((a, b) => (have.get(b) ?? n) - (have.get(a) ?? n) || a.localeCompare(b));
  const words = [adds.length && `Adds ${adds.join(", ")}`, removes.size && `takes ${[...removes].join(", ")} off`].filter(Boolean).join(" · ");
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Tag ${what}`} description={`Words to find them by in ${where}`}
      note={words ? <span className="tag-note">{words.charAt(0).toUpperCase() + words.slice(1)}</span> : undefined}
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" busy={busy} disabled={!changes && !typed} onClick={() => void save()}>{adds.length || typed || !removes.size ? `Tag ${what}` : "Take them off"}</Button></>}>
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        {pics && pics.length > 0 && (
          <div className="tag-what"><span className="tag-pics" aria-hidden>{pics.slice(0, 3).map((src, i) => <img key={i} src={src} alt="" style={{ "--i": Math.min(pics.length, 3) - 1 - i } as React.CSSProperties} />)}</span><span className="body-sm">{what} in {where}</span></div>
        )}
        {shown.length > 0 && (
          <div className="field">
            <span className="field-label">{n === 1 ? "It has" : "They have"}</span>
            <ul className="tag-chips" aria-label={n === 1 ? "Its tags" : "Their tags"}>
              {shown.map((t) => {
                const k = have.get(t) ?? 0;
                if (removes.has(t)) return <li key={t} className="tag-chip" data-gone><s>{t}</s><button type="button" aria-label={`Keep ${t}`} onClick={() => keep(t)}>Keep</button></li>;
                if (onAll(t)) return <li key={t} className="tag-chip" data-new={adds.includes(t) || undefined}>{t}<button type="button" aria-label={`Take ${t} off`} onClick={() => drop(t)}><X size={12} aria-hidden /></button></li>;
                return <li key={t} className="tag-chip" data-some>{t} <span className="tag-chip-n">{k} of {n}</span><button type="button" aria-label={`Add ${t} to the rest`} onClick={() => add(t)}><Plus size={12} aria-hidden /></button></li>;
              })}
            </ul>
          </div>
        )}
        <div className="field">
          <label htmlFor="sel-tag">Add</label>
          <Input id="sel-tag" autoFocus value={text} maxLength={60} aria-invalid={!!err || undefined} placeholder={ranked.length ? "Type, or pick one below" : "A word, like launch or winter"}
            role="combobox" aria-expanded={choices.length > 0} aria-controls="sel-tag-offers" aria-activedescendant={at >= 0 ? `sel-tag-${at}` : undefined}
            onChange={(e) => { const v = e.target.value; if (v.endsWith(",") && v.slice(0, -1).trim()) { add(v.slice(0, -1).trim().slice(0, 40)); return; } setText(v); setLit(-1); setErr(undefined); }}
            onKeyDown={(e) => {
              const len = choices.length;
              if (len && (e.key === "ArrowDown" || (e.key === "ArrowRight" && !text))) { e.preventDefault(); setLit(at < 0 ? 0 : (at + 1) % len); }
              else if (len && (e.key === "ArrowUp" || (e.key === "ArrowLeft" && !text))) { e.preventDefault(); setLit(at <= 0 ? len - 1 : at - 1); }
              else if (e.key === "Enter") { e.preventDefault(); if (at >= 0 && (typed || lit >= 0)) add(choices[at]!.tag); else void save(); }
            }} />
          {choices.length > 0 && (
            <ul className="tag-chips" id="sel-tag-offers" role="listbox" aria-label="Tags to add">
              {choices.map((c, i) => (
                <li key={c.tag} id={`sel-tag-${i}`} role="option" aria-selected={i === at} className="tag-offer" data-fresh={c.fresh || undefined}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => add(c.tag)}>
                  {c.fresh ? <><Plus size={12} aria-hidden /> Make “{c.tag}”</> : <>{c.tag} <span className="tag-chip-n">{c.count}</span></>}
                </li>
              ))}
            </ul>
          )}
          {err ? <span className="field-error" role="alert">{err}</span>
            : <span className="field-hint">{ranked.length ? `The tags in ${where}, the most used first. ↵ adds the one lit, a comma adds what you typed.` : "↵ adds it, a comma adds another."}</span>}
        </div>
      </div>
    </Dialog>
  );
}
