"use client";

// Free stock: search photos, video and sound from the sources that are on (Openverse with no
// key; Pixabay, and Pexels, with a key of the person's own), look before adding,
// and add one to a project's Yarn or the Library. What is added keeps its credit and licence.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type StockSearch } from "@knitted/core/client";
import { LIBRARY_ID, STOCK_SOURCES, needsCredit, type StockItem, type StockKind } from "@knitted/core";
import { Button, Dialog, EmptyState, Input, SegmentedControl, Select, Skeleton, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { PageHeader } from "./AppShell";

const { Search, Play, ExternalLink, Check, Music, AlertTriangle } = icons;
const KINDS: { value: StockKind; label: string }[] = [{ value: "image", label: "Photos" }, { value: "video", label: "Videos" }, { value: "audio", label: "Sound" }];
const TO_KEY = "knitted.stock.to";
const seconds = (ms?: number) => (ms ? `${Math.round(ms / 1000)}s` : "");

export function StockView() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const kind = (["image", "video", "audio"].includes(params.get("kind") ?? "") ? params.get("kind") : "image") as StockKind;
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const [pages, setPages] = useState(1);
  const [found, setFound] = useState<StockSearch | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [looking, setLooking] = useState<StockItem | null>(null);
  const [added, setAdded] = useState<Record<string, string>>({});
  const { data: projects } = useLive(() => api.projects.list(), []);
  const [to, setTo] = useState<string>("");

  // Where a file goes: the address says, else where the last one went, else the first project.
  useEffect(() => {
    if (!projects) return;
    const asked = params.get("to") ?? (() => { try { return localStorage.getItem(TO_KEY); } catch { return null; } })();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTo(asked && (asked === LIBRARY_ID || projects.some((p) => p.id === asked)) ? asked : projects[0]?.id ?? LIBRARY_ID);
  }, [projects, params]);
  const toName = to === LIBRARY_ID ? "the Library" : projects?.find((p) => p.id === to)?.name ?? "";

  // A search is the address, so Back and a reload keep it.
  const go = (next: { q?: string; kind?: StockKind }) => {
    const u = new URLSearchParams(params);
    if (next.q !== undefined) u.set("q", next.q);
    if (next.kind) u.set("kind", next.kind);
    router.replace(`/stock?${u}`);
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!q.trim()) { setFound(null); return; }
    let live = true;
    setBusy(true); setErr(undefined); setPages(1);
    api.stock.search({ q, kind }).then((r) => { if (live) setFound(r); }).catch((e) => { if (live) setErr((e as Error).message); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [q, kind]);
  const more = async () => {
    setBusy(true);
    try {
      const r = await api.stock.search({ q, kind, page: pages + 1 });
      setPages(pages + 1);
      setFound((f) => f && { items: [...f.items, ...r.items.filter((i) => !f.items.some((x) => x.id === i.id))], sources: r.sources });
    } catch (e) { toast.problem((e as Error).message); } finally { setBusy(false); }
  };
  const add = async (item: StockItem) => {
    setAdded((a) => ({ ...a, [item.id]: "adding" }));
    try {
      const r = await api.stock.add({ id: item.id, kind: item.kind, to });
      try { localStorage.setItem(TO_KEY, to); } catch {}
      setAdded((a) => ({ ...a, [item.id]: r.yarn.id }));
      toast(r.existing ? `${r.yarn.name} was already in ${toName}.` : `Added ${r.yarn.name} to ${toName}.`);
    } catch (e) { setAdded((a) => { const n = { ...a }; delete n[item.id]; return n; }); toast.problem((e as Error).message); }
  };
  const yarnHref = to === LIBRARY_ID ? "/library" : `/projects/${to}/yarn`;
  const asked = found?.sources.filter((s) => s.state !== "none") ?? [];
  // Pexels is not giving out keys for now, so only a source someone can get a key for is suggested.
  const noKey = found?.sources.filter((s) => s.state === "no-key" && !STOCK_SOURCES[s.provider].note) ?? [];

  return (
    <div className="page">
      <PageHeader eyebrow="Stock" title="Free photos, video and sound">
        <div style={{ minWidth: 240 }}>
          <Select aria-label="Add to" value={to} onValueChange={(v) => { setTo(v); try { localStorage.setItem(TO_KEY, v); } catch {} }}
            options={[...(projects ?? []).map((p) => ({ value: p.id, label: `Add to ${p.name}` })), { value: LIBRARY_ID, label: "Add to the Library, for every project" }]} />
        </div>
      </PageHeader>
      <form role="search" onSubmit={(e) => { e.preventDefault(); go({ q: text.trim() }); }} style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        <div style={{ position: "relative", flex: "1 1 320px", maxWidth: 520 }}>
          <Search size={16} aria-hidden style={{ position: "absolute", left: 12, top: 12, color: "var(--ink-muted)" }} />
          <Input aria-label="Search free stock" value={text} onChange={(e) => setText(e.target.value)} placeholder="Try coffee shop, sunrise, applause" style={{ paddingLeft: 36, height: 40 }} />
        </div>
        <SegmentedControl<StockKind> label="Kind" value={kind} onChange={(k) => go({ kind: k, q: text.trim() })} options={KINDS} />
        <Button type="submit" variant="primary" disabled={!text.trim()}>Search</Button>
      </form>

      {noKey.length > 0 && (
        <p className="body-sm" style={{ margin: "0 0 var(--space-4)", color: "var(--ink-muted)" }}>
          {noKey.map((s) => s.name).join(" and ")} {noKey.length === 1 ? "has" : "have"} more {KINDS.find((k) => k.value === kind)!.label.toLowerCase()} with a free key. <Link className="link" href="/settings?tab=stock">Add a key</Link>
        </p>
      )}
      {asked.filter((s) => s.state === "error").map((s) => <p key={s.provider} className="field-error" role="alert" style={{ margin: "0 0 var(--space-3)" }}><AlertTriangle size={14} aria-hidden /> {s.note}</p>)}
      {err && <p className="field-error" role="alert"><AlertTriangle size={14} aria-hidden /> {err}</p>}

      {!q.trim() ? (
        <EmptyState title="Search for what you need" body="Photos, videos, music and sounds that are free for a business to use: from Openverse with no key, and from Pixabay once you add a free key in Settings. Each one keeps its credit and licence when you add it." />
      ) : !found ? (
        <div style={{ display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={220} />)}</div>
      ) : !found.items.length ? (
        <EmptyState title="Nothing found" body={`No ${KINDS.find((k) => k.value === kind)!.label.toLowerCase()} match "${q}". Try fewer or plainer words.`} />
      ) : (
        <>
          <ul aria-label="Results" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-4)", gridTemplateColumns: kind === "audio" ? "repeat(auto-fill, minmax(320px, 1fr))" : "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {found.items.map((item) => <Result key={item.id} item={item} state={added[item.id]} toName={toName} yarnHref={yarnHref} onLook={() => setLooking(item)} onAdd={() => add(item)} />)}
          </ul>
          <div style={{ display: "flex", justifyContent: "center", marginTop: "var(--space-6)" }}>
            {found.sources.some((s) => s.more) && <Button busy={busy} onClick={more}>{busy ? "Looking..." : "More"}</Button>}
          </div>
        </>
      )}
      {asked.some((s) => s.state === "ok") && (
        <footer style={{ marginTop: "var(--space-8)", display: "grid", gap: 4 }}>
          {asked.filter((s) => s.state === "ok").map((s) => <Attribution key={s.provider} provider={s.provider} />)}
        </footer>
      )}
      <Look item={looking} onOpenChange={(o) => !o && setLooking(null)} onAdd={(i) => { void add(i); setLooking(null); }} toName={toName} />
    </div>
  );
}

function Result({ item, state, toName, yarnHref, onLook, onAdd }: { item: StockItem; state?: string; toName: string; yarnHref: string; onLook: () => void; onAdd: () => void }) {
  const src = STOCK_SOURCES[item.provider].name;
  const facts = [item.kind !== "audio" && item.width && item.height ? `${item.width}x${item.height}` : "", seconds(item.durationMs)].filter(Boolean).join(" · ");
  return (
    <li className="card" style={{ padding: "var(--space-2)", display: "grid", gap: 6, alignContent: "start" }}>
      {item.kind === "audio" ? (
        <div style={{ display: "grid", gap: 6, padding: "var(--space-2)" }}>
          <p className="label" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}><Music size={14} aria-hidden /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span></p>
          {item.preview && <audio controls preload="none" src={item.preview} aria-label={`Listen to ${item.title}`} style={{ width: "100%" }} />}
        </div>
      ) : (
        <button type="button" onClick={onLook} aria-label={`Look at ${item.title}`} style={{ position: "relative", padding: 0, border: 0, borderRadius: "var(--radius-sm)", overflow: "hidden", aspectRatio: "4 / 3", background: "var(--surface-sunken)", cursor: "zoom-in" }}>
          {item.thumb && <img src={item.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
          {item.kind === "video" && <span className="play-badge" aria-hidden><Play size={14} fill="currentColor" /></span>}
        </button>
      )}
      <div style={{ padding: "0 var(--space-1)", minWidth: 0 }}>
        {item.kind !== "audio" && <p className="label" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.title}>{item.title}</p>}
        <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.author ? `${item.author} · ` : ""}{src}{facts ? ` · ${facts}` : ""}</p>
        <p className="eyebrow" style={{ margin: "2px 0 0" }}>{item.license}{needsCredit(item.license) ? ", credit needed" : ""}</p>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "0 var(--space-1) var(--space-1)" }}>
        {state && state !== "adding"
          ? <Link className="btn btn-secondary btn-sm" href={yarnHref}><Check size={12} aria-hidden /> Added, see it</Link>
          : <Button size="sm" variant="primary" disabled={state === "adding" || !toName} aria-label={`Add ${item.title} to ${toName}`} onClick={onAdd}>{state === "adding" ? "Adding..." : "Add"}</Button>}
        <a className="btn btn-ghost btn-sm" href={item.page} target="_blank" rel="noreferrer" aria-label={`${item.title}, its page${item.provider === "openverse" ? "" : ` on ${src}`}`}><ExternalLink size={12} aria-hidden /></a>
      </div>
    </li>
  );
}

/** What a source asks a page of its results to say, with its name a link to it. */
function Attribution({ provider }: { provider: StockItem["provider"] }) {
  const s = STOCK_SOURCES[provider];
  const at = s.attribution.indexOf(s.name);
  const link = <a className="link" href={s.site} target="_blank" rel="noreferrer">{s.name}</a>;
  return <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{at < 0 ? <>{s.attribution} {link}</> : <>{s.attribution.slice(0, at)}{link}{s.attribution.slice(at + s.name.length)}</>}</p>;
}

/** A photo or a video, bigger, with who made it and its licence, before adding it. */
function Look({ item, onOpenChange, onAdd, toName }: { item: StockItem | null; onOpenChange: (o: boolean) => void; onAdd: (i: StockItem) => void; toName: string }) {
  if (!item) return null;
  const src = STOCK_SOURCES[item.provider].name;
  return (
    <Dialog open onOpenChange={onOpenChange} wide title={item.title} description={`${item.author ? `By ${item.author}, on` : "On"} ${src}. ${item.license}${needsCredit(item.license) ? ": credit the maker where you use it." : "."}`}
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button><Button variant="primary" onClick={() => onAdd(item)}>Add to {toName}</Button></>}>
      <div style={{ display: "grid", placeItems: "center", background: "var(--surface-sunken)", borderRadius: "var(--radius-md)", overflow: "hidden", maxHeight: "60vh" }}>
        {item.kind === "video" && item.preview
          ? <video src={item.preview} poster={item.thumb} controls autoPlay muted loop playsInline style={{ maxWidth: "100%", maxHeight: "60vh" }} />
          : <img src={item.preview ?? item.thumb} alt={item.title} referrerPolicy="no-referrer" style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain" }} />}
      </div>
      <p className="body-sm" style={{ margin: "var(--space-3) 0 0", display: "flex", gap: 12, flexWrap: "wrap" }}>
        <a className="link" href={item.page} target="_blank" rel="noreferrer">{item.provider === "openverse" ? "See its page" : `See it on ${src}`}</a>
        {item.authorUrl && <a className="link" href={item.authorUrl} target="_blank" rel="noreferrer">{item.author}</a>}
        {item.licenseUrl && <a className="link" href={item.licenseUrl} target="_blank" rel="noreferrer">The licence</a>}
      </p>
    </Dialog>
  );
}
