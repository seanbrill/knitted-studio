import { z } from "zod";
import { FOLDER_SECTIONS, type FolderSection } from "@knitted/core";
import { createFolder, deleteFolder, listFolders, moveToFolder, renameFolder } from "@knitted/core/node";
import { body, fail, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const Section = z.enum(FOLDER_SECTIONS as [FolderSection, ...FolderSection[]]);
const Path = z.string().max(400);

/** `?section=yarn`: every folder in that section of the project, in order. */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const section = Section.safeParse(new URL(req.url).searchParams.get("section"));
  if (!section.success) return fail(400, "validation", `Say which section's folders: ?section= one of ${FOLDER_SECTIONS.join(", ")}.`);
  const s = store(); const { id } = await params;
  s.getProject(id);
  return ok({ section: section.data, folders: listFolders(s, id, section.data) });
});

// Making, renaming (and moving, which is renaming to a whole new path), deleting, and
// filing things in one. Deleting a folder deletes nothing in it.
const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), section: Section, path: Path }),
  z.object({ action: z.literal("rename"), section: Section, from: Path, to: Path }),
  z.object({ action: z.literal("delete"), section: Section, path: Path }),
  z.object({ action: z.literal("move"), section: Section, ids: z.array(z.string().max(64)).min(1).max(10_000), folder: Path }),
]);
export const POST = route(async (req: Request, { params }: Ctx) => {
  const s = store(); const { id } = await params;
  const b = await body(req, Action);
  if (b.action === "create") return ok({ path: createFolder(s, id, b.section, b.path) }, 201);
  if (b.action === "rename") return ok({ path: renameFolder(s, id, b.section, b.from, b.to) });
  if (b.action === "delete") return ok(deleteFolder(s, id, b.section, b.path));
  return ok(moveToFolder(s, id, b.section, b.ids, b.folder));
});
