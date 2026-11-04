import { notFound } from "next/navigation";
import { activeSwatch, listParts, listYarn } from "@knitted/core/node";
import { EditorShell } from "@/components/editor/EditorShell";
import { store } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ pid: string }> }) {
  try { return { title: store().getPattern((await params).pid).name }; } catch { return { title: "Editor" }; }
}

export default async function Page({ params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  let pattern;
  try {
    pattern = store().getPattern(pid);
  } catch (e) {
    if ((e as { kind?: string }).kind === "not_found") notFound();
    throw e;
  }
  if (pattern.projectId !== id) notFound();
  const s = store();
  return (
    <EditorShell
      projectId={id}
      pattern={pattern}
      swatch={activeSwatch(s, id)}
      yarn={listYarn(s, id)}
      parts={listParts(s, id)}
      patterns={s.listPatterns(id).map((p) => ({ id: p.id, name: p.name, size: `${p.size.name} ${p.size.w}x${p.size.h}`, folder: p.folder }))}
    />
  );
}
