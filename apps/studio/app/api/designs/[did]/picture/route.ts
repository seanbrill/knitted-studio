import { getDesign } from "@knitted/core/node";
import { renderDesign } from "@knitted/engine";
import { fail, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

const fileName = (s: string) => s.replace(/[^\w .-]+/g, "").trim().slice(0, 80) || "design";

/** The sheet, one section (?section=) or one frame (?frame=), drawn as a PNG to download. */
export const GET = route(async (req: Request, { params }: { params: Promise<{ did: string }> }) => {
  const { did } = await params;
  const q = new URL(req.url).searchParams;
  const s = store();
  const d = getDesign(s, did);
  const frame = q.get("frame") ?? undefined;
  const section = q.get("section") ?? undefined;
  const label = frame ? d.sections.flatMap((x) => x.frames).find((f) => f.id === frame)?.name : section ? d.sections.find((x) => x.id === section)?.name : undefined;
  try {
    const png = await renderDesign(s, did, { frameId: frame, sectionId: section, scale: q.get("scale") === "2" ? 2 : 1 });
    return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "no-store", "content-disposition": `attachment; filename="${fileName(label ? `${d.name} - ${label}` : d.name)}.png"` } });
  } catch (e) {
    if ((e as { kind?: string }).kind === "renderer_unavailable") return fail(503, "renderer_unavailable", (e as Error).message);
    throw e;
  }
});
