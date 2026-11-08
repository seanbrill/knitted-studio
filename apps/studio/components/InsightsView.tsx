"use client";

// How posts did, and what the person's own posts say works. Each platform's numbers, a few
// plain sentences on what did better (only when there are posts enough to say), and every
// post with its numbers. Each post is compared with the usual for its own account, about a
// week in, so a small account and a big one, or a new post and an old one, are fair.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PLATFORMS, metricsLine, pct, type Insights } from "@knitted/core";
import { api } from "@knitted/core/client";
import { EmptyState, Select, Skeleton, icons } from "@knitted/ui";
import { timeAgo, useLive } from "@/lib/hooks";
import { PageHeader } from "./AppShell";

const { ExternalLink } = icons;
type PostResult = Insights["posts"][number];

const n = (v: number) => v.toLocaleString("en-US");
const lift = (l: number) => `${Math.round(l * 10) / 10}× usual`;
/** An empty cell: a dash to see, "none" to hear. */
const none = <><span aria-hidden>–</span><span className="sr-only">none</span></>;

export function InsightsView() {
  const params = useSearchParams();
  const router = useRouter();
  const projectId = params.get("project") ?? "";
  const { data } = useLive(() => api.posts.insights(projectId || undefined), [projectId]);
  const { data: projects } = useLive(() => api.projects.list(), []);
  const names = new Map((projects ?? []).map((p) => [p.id, p.name]));
  return (
    <div style={{ padding: "var(--space-8)", maxWidth: 1080 }}>
      <PageHeader eyebrow="Insights" title="What works">
        <div style={{ minWidth: 220 }}>
          <Select aria-label="Project" value={projectId || "all"} onValueChange={(v) => router.replace(v === "all" ? "/insights" : `/insights?project=${encodeURIComponent(v)}`)}
            options={[{ value: "all", label: "All projects" }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        </div>
      </PageHeader>
      {!data ? <Skeleton height={240} /> : !data.posts.length ? (
        <EmptyState title="Nothing posted yet" body="Once posts go out, knitted asks each platform how they are doing, and what works shows here. Post from a knit, or from a project's Posts." />
      ) : (
        <div style={{ display: "grid", gap: "var(--space-8)" }}>
          <p className="body" style={{ margin: 0, color: "var(--ink-muted)", maxWidth: 720 }}>{data.note}</p>
          <Platforms data={data} />
          <Findings data={data} />
          <Posts data={data} names={projectId ? null : names} />
        </div>
      )}
    </div>
  );
}

function Platforms({ data }: { data: Insights }) {
  return (
    <section aria-labelledby="ins-platforms">
      <h2 id="ins-platforms" className="h3" style={{ marginBottom: "var(--space-3)" }}>By platform</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--space-3)" }}>
        {data.platforms.map((p) => (
          <li key={p.platform} className="card" style={{ padding: "var(--space-4)", display: "grid", gap: 4 }}>
            <h3 className="label" style={{ margin: 0 }}>{PLATFORMS[p.platform].name}</h3>
            <p className="h2" style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>{p.measured ? n(p.views) : "No numbers"}<span className="body-sm" style={{ color: "var(--ink-muted)", fontWeight: 400 }}>{p.measured ? " views" : ""}</span></p>
            <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>
              {p.posts === 1 ? "1 post" : `${p.posts} posts`}
              {p.measured >= 3 && p.medianViews != null ? ` · ${n(Math.round(p.medianViews))} views on a usual post` : ""}
              {p.medianEngagement != null ? ` · ${pct(p.medianEngagement)} engaged${p.measured >= 3 ? " on a usual post" : ""}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Findings({ data }: { data: Insights }) {
  const clear = data.findings.filter((f) => f.clear), close = data.findings.filter((f) => !f.clear);
  if (!data.findings.length) return null;
  return (
    <section aria-labelledby="ins-findings">
      <h2 id="ins-findings" className="h3" style={{ marginBottom: "var(--space-3)" }}>What your posts say</h2>
      {clear.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: "1.2em", display: "grid", gap: 8, maxWidth: 760 }}>
          {clear.map((f) => <li key={f.factor} className="body"><strong>{f.factor}.</strong> {f.text}</li>)}
        </ul>
      )}
      {close.length > 0 && (
        <>
          <h3 className="eyebrow" style={{ margin: "var(--space-4) 0 6px" }}>No clear difference</h3>
          <ul style={{ margin: 0, paddingLeft: "1.2em", display: "grid", gap: 4, maxWidth: 760, color: "var(--ink-muted)" }}>
            {close.map((f) => <li key={f.factor} className="body-sm">{f.text}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}

function Posts({ data, names }: { data: Insights; names: Map<string, string> | null }) {
  return (
    <section aria-labelledby="ins-posts">
      <h2 id="ins-posts" className="h3" style={{ marginBottom: "var(--space-3)" }}>Every post</h2>
      <div style={{ overflowX: "auto" }}>
        <table className="body-sm spend-table">
          <thead>
            <tr><th scope="col">Post</th><th scope="col">Platform</th><th scope="col" style={{ whiteSpace: "nowrap" }}>Went out</th><th scope="col">Views</th><th scope="col">Engaged</th><th scope="col">Against its usual</th><th scope="col"><span className="sr-only">Link</span></th></tr>
          </thead>
          <tbody>{data.posts.map((p) => <PostRow key={p.id} p={p} project={names?.get(p.projectId) ?? null} />)}</tbody>
        </table>
      </div>
      <p className="body-sm" style={{ color: "var(--ink-muted)", margin: "var(--space-2) 0 0" }}>Views are each platform's own count: X counts every time a post is shown, YouTube every time a video starts. Engaged is likes, comments, shares, reposts and saves, out of views.</p>
    </section>
  );
}

function PostRow({ p, project }: { p: PostResult; project: string | null }) {
  const name = PLATFORMS[p.platform].name;
  const words = (p.title || p.caption || "No caption").split("\n")[0];
  return (
    <tr>
      <td style={{ maxWidth: 320 }}>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={metricsLine(p.metrics)}>{words}</span>
        {project && <Link className="link" href={`/projects/${p.projectId}/posts`} style={{ fontSize: 12 }}>{project}</Link>}
        {p.note && <span style={{ display: "block", color: "var(--ink-muted)", fontSize: 12 }}>{p.note}</span>}
      </td>
      <td>{name}</td>
      <td style={{ whiteSpace: "nowrap" }}><time dateTime={p.postedAt} title={new Date(p.postedAt).toLocaleString()}>{timeAgo(p.postedAt)}</time></td>
      <td>{p.views != null ? n(p.views) : none}</td>
      <td>{p.engagement != null ? pct(p.engagement) : none}</td>
      <td>{p.lift != null ? <strong style={{ color: p.lift >= 1.25 ? "var(--success)" : undefined }}>{lift(p.lift)}</strong> : <span style={{ color: "var(--ink-muted)" }}>{p.waiting}</span>}</td>
      <td>{p.url && <a className="btn btn-ghost btn-sm" href={p.url} target="_blank" rel="noreferrer" aria-label={`Open on ${name}`}><ExternalLink size={13} aria-hidden /></a>}</td>
    </tr>
  );
}
