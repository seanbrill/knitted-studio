import { notFound } from "next/navigation";
import { activeSwatch, getDesign } from "@knitted/core/node";
import { DesignBoard } from "@/components/DesignBoard";
import { store } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ did: string }> }) {
  try { return { title: getDesign(store(), (await params).did).name }; } catch { return { title: "Design" }; }
}

export default async function Page({ params }: { params: Promise<{ id: string; did: string }> }) {
  const { id, did } = await params;
  let design;
  try {
    design = getDesign(store(), did);
  } catch (e) {
    if ((e as { kind?: string }).kind === "not_found") notFound();
    throw e;
  }
  if (design.projectId !== id || design.deletedAt) notFound();
  return <DesignBoard projectId={id} initial={design} swatch={activeSwatch(store(), id)} />;
}
