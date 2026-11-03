"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@knitted/core/client";
import { SwatchChip, Skeleton, icons, useToast } from "@knitted/ui";
import { useState } from "react";
import { useLive } from "@/lib/hooks";
import { RenameDialog } from "./ProjectsView";

const { ArrowLeft, Pencil } = icons;

const TABS = [
  { href: "", label: "Patterns" },
  { href: "/yarn", label: "Yarn" },
  { href: "/swatch", label: "Swatch" },
  { href: "/parts", label: "Parts" },
  { href: "/knits", label: "Knits" },
];

function ActiveSwatchChip({ projectId, swatchId }: { projectId: string; swatchId: string | null }) {
  const { data } = useLive(() => api.swatches.list(projectId), [projectId, swatchId]);
  const sw = data?.find((s) => s.id === swatchId) ?? data?.[0];
  if (!sw) return null;
  return <Link href={`/projects/${projectId}/swatch`} aria-label={`Swatch: ${sw.name}`}><SwatchChip name={sw.name} colors={sw.colors.map((c) => c.hex)} /></Link>;
}

export function ProjectShell({ id, children }: { id: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const toast = useToast();
  const { data: project, error, refresh } = useLive(() => api.projects.get(id), [id]);
  const [renaming, setRenaming] = useState(false);
  const base = `/projects/${id}`;

  if (error) return <div style={{ padding: "var(--space-8)" }}><Link href="/projects" className="link">Back to projects</Link><p role="alert" className="field-error" style={{ marginTop: 12 }}>{error}</p></div>;

  return (
    <div style={{ padding: "var(--space-8)", maxWidth: 1200 }}>
      <Link href="/projects" className="body-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink-muted)", marginBottom: "var(--space-4)" }}>
        <ArrowLeft size={14} aria-hidden /> Projects
      </Link>
      <header style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-6)" }}>
        {project ? (
          <>
            <h1 className="h1" style={{ margin: 0 }}>{project.name}</h1>
            <button className="icon-btn" aria-label="Rename project" onClick={() => setRenaming(true)}><Pencil size={15} /></button>
            <ActiveSwatchChip projectId={id} swatchId={project.swatchId} />
          </>
        ) : <Skeleton width={260} height={36} />}
      </header>
      <nav aria-label="Project sections" className="tabs-list" style={{ marginBottom: "var(--space-6)" }}>
        {TABS.map((t) => {
          const href = base + t.href;
          const on = t.href === "" ? pathname === base : pathname.startsWith(href);
          return <Link key={t.label} href={href} className="tab" data-state={on ? "active" : "inactive"} aria-current={on ? "page" : undefined}>{t.label}</Link>;
        })}
      </nav>
      {children}
      <RenameDialog open={renaming} onOpenChange={setRenaming} title="Rename project" initial={project?.name ?? ""}
        onSave={async (name) => { await api.projects.update(id, { name }); await refresh(); toast("Renamed"); }} />
    </div>
  );
}
