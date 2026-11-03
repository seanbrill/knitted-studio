"use client";

import Link from "next/link";
import { api } from "@knitted/core/client";
import { Skeleton, StitchRow } from "@knitted/ui";
import { timeAgo, useLive } from "@/lib/hooks";

// The first screen. A brand field and one primary action, per the theme; once
// there is work, the recent projects sit below it.
export function HomeView() {
  const { data } = useLive(() => api.projects.list());
  const recent = (data ?? []).slice(0, 6);
  const first = data && data.every((p) => p.example);
  return (
    <div style={{ padding: "var(--space-8)", maxWidth: 1100 }}>
      <section style={{ background: "var(--ember)", color: "var(--on-ember)", borderRadius: "var(--radius-lg)", padding: "var(--space-16) var(--space-12)", position: "relative", overflow: "hidden" }}>
        <div aria-hidden style={{ position: "absolute", right: -20, top: 20, color: "var(--oxblood)", opacity: 0.55, display: "grid", gap: 6 }}>
          {[7, 6, 7, 6, 7].map((n, i) => <StitchRow key={i} count={n} size={34} />)}
        </div>
        <p className="eyebrow" style={{ color: "var(--on-ember)" }}>{first ? "Welcome" : "Welcome back"}</p>
        <h1 className="display" style={{ margin: "var(--space-3) 0 var(--space-4)", maxWidth: 560 }}>
          Make it <span className="accent" style={{ fontWeight: 400 }}>knitted.</span>
        </h1>
        <p className="body-lg prose" style={{ marginBottom: "var(--space-8)", maxWidth: 480 }}>
          Set your brand once as a pattern. Then knit as many posts, stories and ads from it as you like.
        </p>
        <Link href="/projects?new=1" className="btn btn-dark btn-lg">{first ? "Create your first project" : "New project"}</Link>
      </section>

      <section style={{ marginTop: "var(--space-10)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "var(--space-4)" }}>
          <h2 className="h2">Recent</h2>
          <Link href="/projects" className="link body-sm">All projects</Link>
        </div>
        {!data ? <Skeleton height={80} /> : (
          <div style={{ display: "grid", gap: "var(--space-3)", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {recent.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="card card-link" style={{ padding: "var(--space-4)" }}>
                <p className="label" style={{ margin: 0 }}>{p.name}</p>
                <p className="body-sm" style={{ margin: "2px 0 0", color: "var(--ink-muted)" }}>{p.counts.patterns} patterns · {timeAgo(p.updatedAt)}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
