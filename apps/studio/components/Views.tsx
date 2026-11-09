"use client";

// How a section is laid out and in what order, the same everywhere: as a grid of pictures or a
// list, sorted by what the person picks. Each section remembers its own choice on this
// computer, so Yarn can stay a list while Patterns stay a grid.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Input, Menu, Popover, Tip, ToggleChip, icons, type MenuItems } from "@knitted/ui";

const { ArrowDown, ArrowUp, ArrowUpDown, LayoutGrid, List, Tag } = icons;

export type ViewMode = "grid" | "list";

/**
 * One way to sort: how to read the value from a thing, which way round it starts (`desc`),
 * and the words for each way round, like ["newest first", "oldest first"]. Reversing is a
 * switch of its own, not another way to sort.
 */
export interface SortBy<T> { value: string; label: string; key: (t: T) => string | number; desc?: boolean; ways?: [string, string] }

const KEY = (section: string) => `knitted.view.${section}`;
const collate = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
// Orders kept from before Reverse, read as the order they are the reverse of.
const OLD: Record<string, [string, boolean]> = { oldest: ["newest", true], "name-desc": ["name", true] };

/** The person's layout and order for one section, kept on this computer. */
export function useView<T>(section: string, sorts: SortBy<T>[], defaults: { mode?: ViewMode; sort?: string } = {}) {
  const [mode, setModeState] = useState<ViewMode>(defaults.mode ?? "grid");
  const [sort, setSortState] = useState(defaults.sort ?? sorts[0].value);
  const [reverse, setReverseState] = useState(false);
  useEffect(() => {
    // Read after mount: the server draws the default, so the first paint matches it.
    try {
      const v = JSON.parse(localStorage.getItem(KEY(section)) ?? "{}") as { mode?: ViewMode; sort?: string; reverse?: boolean };
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v.mode === "grid" || v.mode === "list") setModeState(v.mode);
      const [was, flip] = v.sort && OLD[v.sort] && !sorts.some((s) => s.value === v.sort) ? OLD[v.sort] : [v.sort, false];
      if (was && sorts.some((s) => s.value === was)) { setSortState(was); setReverseState(!!v.reverse !== flip); }
    } catch { /* nothing kept, or not readable: the defaults */ }
  }, [section]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = useCallback((next: { mode?: ViewMode; sort?: string; reverse?: boolean }) => {
    try { localStorage.setItem(KEY(section), JSON.stringify({ ...JSON.parse(localStorage.getItem(KEY(section)) ?? "{}"), ...next })); } catch { /* private window: for now only */ }
  }, [section]);
  const setMode = useCallback((m: ViewMode) => { setModeState(m); keep({ mode: m }); }, [keep]);
  // Another way to sort starts the natural way round.
  const setSort = useCallback((s: string) => { setSortState(s); setReverseState(false); keep({ sort: s, reverse: false }); }, [keep]);
  const setReverse = useCallback((r: boolean) => { setReverseState(r); keep({ reverse: r }); }, [keep]);
  const by = sorts.find((s) => s.value === sort) ?? sorts[0];
  const sorted = useCallback((items: T[]) => [...items].sort((a, b) => {
    const x = by.key(a), y = by.key(b);
    const n = typeof x === "number" && typeof y === "number" ? x - y : collate.compare(String(x), String(y));
    return (by.desc ? -n : n) * (reverse ? -1 : 1);
  }), [by, reverse]);
  /** The way round it is now, in words, like "oldest first". */
  const way = by.ways ? by.ways[reverse ? 1 : 0] : reverse ? "reversed" : "";
  return { mode, setMode, sort: by.value, setSort, reverse, setReverse, way, sorts, sorted };
}

export type View<T> = ReturnType<typeof useView<T>>;

/** The sort, as a menu with one tick and a way to reverse it, and the layout toggle, for a section's toolbar. */
export function ViewBar<T>({ view, what }: { view: View<T>; what: string }) {
  const by = view.sorts.find((s) => s.value === view.sort) ?? view.sorts[0];
  const items: MenuItems = [
    ...view.sorts.map((s) => ({ label: s.label, checked: s.value === view.sort, aside: s.ways?.[s.value === view.sort && view.reverse ? 1 : 0], onSelect: () => (s.value === view.sort ? undefined : view.setSort(s.value)) })),
    "separator",
    { label: "Reverse the order", icon: <ArrowUpDown size={14} aria-hidden />, onSelect: () => view.setReverse(!view.reverse) },
  ];
  return (
    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", marginLeft: "auto" }}>
      <Menu label="Sort by" items={items} trigger={
        <button type="button" className="btn btn-secondary sort-btn" aria-label={`Sort ${what}: ${by.label}${view.way ? `, ${view.way}` : ""}`}>
          {by.label}{view.reverse ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden />}
        </button>} />
      <div className="segmented" role="radiogroup" aria-label={`Show ${what} as`}>
        <Tip text="A grid of pictures"><button type="button" role="radio" aria-checked={view.mode === "grid"} aria-label="Grid" onClick={() => view.setMode("grid")}><LayoutGrid size={15} aria-hidden /></button></Tip>
        <Tip text="A list, with more about each"><button type="button" role="radio" aria-checked={view.mode === "list"} aria-label="List" onClick={() => view.setMode("list")}><List size={15} aria-hidden /></button></Tip>
      </div>
    </div>
  );
}

/** The ways most sections sort: the last changed, when made, and by name. */
export function commonSorts<T extends { name?: string; label?: string; createdAt: string; updatedAt?: string }>(): SortBy<T>[] {
  return [
    { value: "updated", label: "Last changed", key: (t) => t.updatedAt ?? t.createdAt, desc: true, ways: ["newest first", "oldest first"] },
    { value: "newest", label: "Made", key: (t) => t.createdAt, desc: true, ways: ["newest first", "oldest first"] },
    { value: "name", label: "Name", key: (t) => t.name ?? t.label ?? "", ways: ["A to Z", "Z to A"] },
  ];
}

/** The grid's columns, or the list's one, as a style for the list element. */
export const layout = (mode: ViewMode, min = 180): React.CSSProperties => mode === "grid"
  ? { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-4)", gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }
  : { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 };

/**
 * Filter by a tag without a row of every tag: the most used few as chips, and the rest in a
 * Tags menu that can be searched. The tag picked is always shown, so it can be let go of.
 */
/** Tags to filter by: the most used as chips, the rest behind a button. With `show` 0, all of them are behind one Tags button, and only the one picked shows beside it. */
export function TagFilter({ tags, value, onChange, show = 5 }: { tags: string[][]; value?: string; onChange: (t: string | undefined) => void; show?: number }) {
  const [find, setFind] = useState("");
  const ranked = useMemo(() => {
    const n = new Map<string, number>();
    for (const ts of tags) for (const t of ts) n.set(t, (n.get(t) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || collate.compare(a[0], b[0])).map(([t]) => t);
  }, [tags]);
  if (!ranked.length) return null;
  const top = ranked.slice(0, show);
  if (value && !top.includes(value)) top.push(value);
  const pick = (t: string) => onChange(value === t ? undefined : t);
  const rest = ranked.filter((t) => !top.includes(t) && t.toLowerCase().includes(find.trim().toLowerCase()));
  return (
    <>
      {top.map((t) => <ToggleChip key={t} pressed={value === t} onClick={() => pick(t)}>{t}</ToggleChip>)}
      {ranked.length > top.length && (
        <Popover trigger={<button className="chip chip-button" aria-label={`All ${ranked.length} tags`}><Tag size={13} aria-hidden /> {show === 0 ? "Tags" : `${ranked.length - top.length} more`}</button>}>
          <div style={{ display: "grid", gap: "var(--space-2)", width: 280 }}>
            <Input aria-label="Find a tag" placeholder="Find a tag" value={find} onChange={(e) => setFind(e.target.value)} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 240, overflowY: "auto" }}>
              {rest.map((t) => <ToggleChip key={t} pressed={value === t} onClick={() => pick(t)}>{t}</ToggleChip>)}
              {!rest.length && <span className="body-sm" style={{ color: "var(--ink-muted)" }}>No other tag has those letters.</span>}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}

