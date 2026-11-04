import { basename } from "node:path";
import { isInside, nameOf } from "@knitted/core";
import { folderNamed, getKnit, knitPath, listKnits, zipStream } from "@knitted/core/node";
import { fail, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

// A folder's name as a folder in the zip: the characters some computers cannot have in one become a dash.
const safe = (name: string) => name.replace(/[\\:*?"<>|]/g, "-");

/**
 * `?ids=a,b` or `?batch=bt_...` or `?folder=Spring` (that folder and the folders inside
 * it) or none (everything). A whole folder, or everything, keeps its folders in the zip.
 * Streams, so a big batch never sits in memory.
 */
export const GET = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = store(); const { id } = await params;
  const q = new URL(req.url).searchParams;
  const ids = q.get("ids")?.split(",").filter(Boolean);
  const batchId = q.get("batch") ?? undefined;
  const folder = folderNamed(s, id, "knits", q.get("folder"));
  const knits = ids ? ids.map((k) => getKnit(s, k)).filter((k) => k.projectId === id) : listKnits(s, id, { batchId, folder });
  if (!knits.length) return fail(404, "not_found", folder ? "There is nothing in that folder to download yet." : "There is nothing to download yet. Knit something first.");
  const tree = !ids && !batchId;
  const dirOf = (folderOfKnit: string) => (tree && folderOfKnit && isInside(folderOfKnit, folder) ? folderOfKnit.slice(folder ? folder.length + 1 : 0) : "").split("/").filter(Boolean).map(safe).join("/");
  const used = new Set<string>();
  const entries = knits.map((k) => {
    const dir = dirOf(k.folder);
    let name = basename(k.file);
    while (used.has(`${dir}/${name}`)) name = `${used.size}-${name}`;
    used.add(`${dir}/${name}`);
    return { name: dir ? `${dir}/${name}` : name, path: knitPath(s, k) };
  });
  const label = [s.getProject(id).name, folder && nameOf(folder)].filter(Boolean).join(" ").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new Response(zipStream(entries) as unknown as BodyInit, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${label}-knits.zip"` } });
});
