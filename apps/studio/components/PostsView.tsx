"use client";

// A project's posts: what needs the person (failed, missed, drafts), what is scheduled, and
// what went out, with a link to each on its platform.

import Link from "next/link";
import { useState } from "react";
import { PLATFORMS, metricsLine } from "@knitted/core";
import { api, knitFileUrl, type KnitRecord, type SocialAccount, type SocialPost } from "@knitted/core/client";
import { Button, ConfirmDialog, Dialog, EmptyState, Field, Input, Skeleton, icons, useToast } from "@knitted/ui";
import { timeAgo, useLive } from "@/lib/hooks";

const { AlertTriangle, CalendarClock, ExternalLink, Send, Trash2, Check, RefreshCw } = icons;

const GROUPS: { title: string; status: SocialPost["status"][]; empty?: string }[] = [
  { title: "Needs you", status: ["failed", "missed"] },
  { title: "Drafts", status: ["draft"] },
  { title: "Scheduled", status: ["scheduled", "posting"] },
  { title: "Posted", status: ["posted"] },
  { title: "Cancelled", status: ["cancelled"] },
];

const localInput = (iso: string | null) => {
  const d = iso ? new Date(iso) : new Date(Date.now() + 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function PostsView({ projectId }: { projectId: string }) {
  const { data: posts } = useLive(() => api.posts.list(projectId), [projectId]);
  const { data: knits } = useLive(() => api.knit.list(projectId), [projectId]);
  const { data: accounts } = useLive(() => api.social.accounts(), []);
  const [moving, setMoving] = useState<SocialPost | null>(null);
  if (!posts || !knits || !accounts) return <Skeleton height={200} />;
  const byKnit = new Map(knits.map((k) => [k.id, k]));
  const byAccount = new Map(accounts.map((a) => [a.id, a]));
  const sorted = (list: SocialPost[], g: (typeof GROUPS)[number]) => g.title === "Scheduled" ? [...list].sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? "")) : list;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        <h2 className="h2" style={{ margin: 0 }}>Posts</h2>
        {posts.some((p) => p.status === "posted") && <Link className="link body-sm" href={`/insights?project=${encodeURIComponent(projectId)}`}>What works, in Insights</Link>}
      </div>
      {posts.length === 0 ? (
        <EmptyState title="Nothing posted yet" body={accounts.length ? "Open a knit and press Post, or pick several and post them together." : "Connect your accounts in Settings, Social, then open a knit and press Post."} />
      ) : (
        <div style={{ display: "grid", gap: "var(--space-8)" }}>
          {GROUPS.map((g) => {
            const list = sorted(posts.filter((p) => g.status.includes(p.status)), g);
            if (!list.length) return null;
            return (
              <section key={g.title} aria-label={g.title}>
                <h3 className="eyebrow" style={{ marginBottom: 8 }}>{g.title} · {list.length}</h3>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                  {list.map((p) => <PostRow key={p.id} p={p} knit={byKnit.get(p.knitIds[0])} count={p.knitIds.length} account={p.accountId ? byAccount.get(p.accountId) : undefined} onMove={() => setMoving(p)} />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <MoveDialog post={moving} onClose={() => setMoving(null)} />
    </div>
  );
}

function PostRow({ p, knit, count, account, onMove }: { p: SocialPost; knit?: KnitRecord; count: number; account?: SocialAccount; onMove: () => void }) {
  const toast = useToast();
  const [del, setDel] = useState(false);
  const name = PLATFORMS[p.platform].name;
  const who = account ? (account.handle ? `@${account.handle}` : account.name) : "a disconnected account";
  const act = async (f: () => Promise<unknown>, done: string) => { try { await f(); toast(done); } catch (e) { toast.problem((e as Error).message); } };
  const time = p.status === "posted" ? `Posted ${timeAgo(p.postedAt ?? p.updatedAt)}` : p.scheduledAt ? `${p.status === "scheduled" ? "Goes out" : "Was due"} ${new Date(p.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : `Made ${timeAgo(p.createdAt)}`;
  const failed = p.status === "failed" || p.status === "missed";
  return (
    <li className="card" style={{ padding: "8px var(--space-3) 8px 8px", display: "grid", gridTemplateColumns: "56px minmax(0, 1fr) auto", gap: "var(--space-3)", alignItems: "center" }}>
      <div aria-hidden className="thumb" style={{ width: 56, height: 56, padding: 4 }}>
        {knit ? (knit.kind === "image" ? <img src={knitFileUrl(knit)} alt="" loading="lazy" style={{ display: "block", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <video src={knitFileUrl(knit)} muted preload="metadata" style={{ display: "block", maxWidth: "100%", maxHeight: "100%" }} />) : null}
      </div>
      <div style={{ minWidth: 0 }}>
        <p className="label" style={{ margin: 0 }}>{name} · {who}{count > 1 ? ` · ${count} knits` : ""}</p>
        <p className="body-sm" style={{ margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title ? `${p.title}: ` : ""}{p.caption || "No caption"}</p>
        <p className="eyebrow" style={{ margin: "2px 0 0", textTransform: "none", letterSpacing: 0 }}>{p.status === "posting" ? "Posting now..." : time}{p.by === "model" ? " · made by your model" : ""}{p.options.uploaded ? " · on YouTube, waiting for its time" : ""}</p>
        {p.status === "posted" && <Numbers p={p} />}
        {p.error && <p className="body-sm" role={failed ? "alert" : undefined} style={{ margin: "4px 0 0", color: failed ? "var(--danger)" : "var(--ink-muted)", display: "flex", gap: 4, alignItems: "flex-start" }}>{failed && <AlertTriangle size={13} aria-hidden style={{ flex: "none", marginTop: 3 }} />}{p.error}</p>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {p.url && <a className="btn btn-secondary btn-sm" href={p.url} target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden /> Open on {name}</a>}
        {(p.status === "draft" || failed) && <Button size="sm" onClick={() => act(() => api.posts.update(p.id, { at: new Date().toISOString() }), "Posting now.")}><Send size={13} aria-hidden /> Post now</Button>}
        {(p.status === "draft" || failed || (p.status === "scheduled" && !p.options.uploaded)) && <Button size="sm" onClick={onMove}><CalendarClock size={13} aria-hidden /> {p.status === "scheduled" ? "Move" : "Schedule"}</Button>}
        {p.status === "scheduled" && <Button size="sm" variant="ghost" onClick={() => act(() => api.posts.cancel(p.id), "Cancelled.")}>Cancel</Button>}
        {p.status === "posted" && !p.url && <span className="body-sm" style={{ color: "var(--success)", display: "flex", gap: 4, alignItems: "center" }}><Check size={13} aria-hidden /> Posted</span>}
        {p.status !== "posting" && p.status !== "scheduled" && <Button size="sm" variant="ghost" aria-label={`Remove this ${name} post from knitted`} onClick={() => setDel(true)}><Trash2 size={13} aria-hidden /></Button>}
      </div>
      <ConfirmDialog open={del} onOpenChange={setDel} title="Remove it from knitted?" description={p.status === "posted" ? `It stays on ${name}: this only removes it from this list.` : "It will not be posted."} confirmLabel="Remove" onConfirm={() => act(() => api.posts.remove(p.id), "Removed.")} />
    </li>
  );
}

/** How a post that went out is doing, when knitted last asked, and asking again. */
function Numbers({ p }: { p: SocialPost }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const line = metricsLine(p.metrics);
  const check = async () => {
    setBusy(true);
    try { const r = await api.posts.checkMetrics(p.id); toast(r.metricsNote && !r.metrics ? r.metricsNote : "Up to date."); }
    catch (e) { toast.problem((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="body-sm" style={{ margin: "4px 0 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {line ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{line}</span> : !p.metricsNote && <span style={{ color: "var(--ink-muted)" }}>No numbers yet: knitted asks an hour after it goes out.</span>}
      {p.metricsAt && line && <span style={{ color: "var(--ink-muted)" }}>as of {timeAgo(p.metricsAt)}</span>}
      {p.metricsNote && <span style={{ color: "var(--ink-muted)" }}>{p.metricsNote}</span>}
      <Button size="sm" variant="ghost" busy={busy} onClick={check} aria-label={`Check now how this ${PLATFORMS[p.platform].name} post is doing`}><RefreshCw size={13} aria-hidden /> {busy ? "Checking..." : "Check now"}</Button>
    </div>
  );
}

function MoveDialog({ post, onClose }: { post: SocialPost | null; onClose: () => void }) {
  const toast = useToast();
  const [at, setAt] = useState("");
  const open = !!post;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={post?.status === "scheduled" ? "Move it" : "Schedule it"}
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!at} onClick={async () => { try { await api.posts.update(post!.id, { at: new Date(at).toISOString() }); toast(`Scheduled for ${new Date(at).toLocaleString()}.`); onClose(); } catch (e) { toast.problem((e as Error).message); } }}>Schedule</Button></>}>
      {post && <Field label="Post at" htmlFor="move-at" hint="Your computer's time."><Input id="move-at" type="datetime-local" key={post.id} defaultValue={localInput(post.scheduledAt)} onChange={(e) => setAt(e.target.value)} ref={(el) => { if (el && !at) setAt(el.value); }} style={{ maxWidth: 260 }} /></Field>}
    </Dialog>
  );
}
