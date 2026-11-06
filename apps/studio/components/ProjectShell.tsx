"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@knitted/core/client";
import { Breadcrumbs, SwatchChip, Skeleton, Tip, icons, useToast, type Crumb } from "@knitted/ui";
import { useCallback, useState } from "react";
import { useLive } from "@/lib/hooks";
import { RenameDialog } from "./ProjectsView";
import { TrailContext } from "./Trail";

const { Pencil, Sparkles } = icons;

/** A project's sections, each with a line on what it is for: shown on hover, and under the tabs for the one open. */
const TABS = [
  { href: "", label: "Patterns", what: "Designs with slots to fill: a post, a story, a banner. Open one to edit it, or knit it into files." },
  { href: "/brief", label: "Brief", what: "What your model knows about the business: a profile from its website or from you, and reference files to look at." },
  { href: "/yarn", label: "Yarn", what: "Your files to put in patterns: photos, logos, video, sound, fonts, PDFs and copy." },
  { href: "/swatch", label: "Swatch", what: "The brand: its colours, fonts, logo and voice. Every pattern draws with it." },
  { href: "/parts", label: "Parts", what: "Pieces to reuse in any pattern, like a lower third, a quote or a price tag." },
  { href: "/knits", label: "Knits", what: "The finished files: every picture and video knitted from your patterns." },
];

function ActiveSwatchChip({ projectId, swatchId }: { projectId: string; swatchId: string | null }) {
  const { data } = useLive(() => api.swatches.list(projectId), [projectId, swatchId]);
  const sw = data?.find((s) => s.id === swatchId) ?? data?.[0];
  if (!sw) return null;
  return <Tip text="The swatch this project draws with. Open the Swatch tab to change it."><Link href={`/projects/${projectId}/swatch`} aria-label={`Swatch: ${sw.name}`}><SwatchChip name={sw.name} colors={sw.colors.map((c) => c.hex)} /></Link></Tip>;
}

export function ProjectShell({ id, children }: { id: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const { data: project, error, refresh } = useLive(() => api.projects.get(id), [id]);
  const [renaming, setRenaming] = useState(false);
  const [folders, setFolders] = useState<Crumb[] | null>(null);
  const setTrail = useCallback((steps: Crumb[] | null) => setFolders(steps), []);
  const base = `/projects/${id}`;
  const tab = TABS.find((t) => (t.href === "" ? pathname === base : pathname.startsWith(base + t.href))) ?? TABS[0];

  if (error) return <div style={{ padding: "var(--space-8)" }}><Link href="/projects" className="link">Back to projects</Link><p role="alert" className="field-error" style={{ marginTop: 12 }}>{error}</p></div>;

  // Projects > the project > the section, and the folder the section is in, when it is in one.
  // A section's folders start at its own top, which is the section's step, unless it is a shelf
  // inside the section (the Brief's reference).
  const section: Crumb = { label: tab.label, href: base + tab.href, title: tab.what };
  const trail: Crumb[] = [
    { label: "Projects", href: "/projects" },
    { label: project?.name ?? "Project", href: base },
    ...(folders?.length ? (folders[0].label === tab.label ? folders : [section, ...folders]) : [section]),
  ];

  return (
    <TrailContext.Provider value={setTrail}>
      <div style={{ padding: "var(--space-8)", maxWidth: 1200 }}>
        <Breadcrumbs items={trail} linkAs={Link} navigate={(h) => router.push(h)} keep={5} style={{ marginBottom: "var(--space-4)" }} />
        <header style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-6)" }}>
          {project ? (
            <>
              <h1 className="h1" style={{ margin: 0 }}>{project.name}</h1>
              <Tip text="Rename this project"><button className="icon-btn" aria-label="Rename project" onClick={() => setRenaming(true)}><Pencil size={15} /></button></Tip>
              <ActiveSwatchChip projectId={id} swatchId={project.swatchId} />
              <Tip text="Talk to your model about this project: it can fill patterns, write copy and knit."><Link href={`/ask?project=${id}`} className="btn btn-secondary btn-sm" style={{ marginLeft: "auto" }}><Sparkles size={14} aria-hidden /> Ask your model</Link></Tip>
            </>
          ) : <Skeleton width={260} height={36} />}
        </header>
        <nav aria-label="Project sections" className="tabs-list" style={{ marginBottom: "var(--space-2)" }}>
          {TABS.map((t) => {
            const href = base + t.href;
            const on = t === tab;
            return <Tip key={t.label} text={t.what}><Link href={href} className="tab" data-state={on ? "active" : "inactive"} aria-current={on ? "page" : undefined} aria-describedby={on ? "section-what" : undefined}>{t.label}</Link></Tip>;
          })}
        </nav>
        <p id="section-what" className="body-sm" style={{ margin: "0 0 var(--space-6)", color: "var(--ink-muted)" }}>{tab.what}</p>
        {children}
        <RenameDialog open={renaming} onOpenChange={setRenaming} title="Rename project" initial={project?.name ?? ""}
          onSave={async (name) => { await api.projects.update(id, { name }); await refresh(); toast("Renamed"); }} />
      </div>
    </TrailContext.Provider>
  );
}
