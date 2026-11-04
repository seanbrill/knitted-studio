import { cleanFolder, importYarn, listYarn, uploadTempPath, DEFAULT_MAX_BYTES } from "@knitted/core/node";
import { fail, ok, route, store } from "@/lib/server";
import { bodyToFile } from "@/lib/upload-stream";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req: Request, { params }: Ctx) => {
  const q = new URL(req.url).searchParams;
  return ok(listYarn(store(), (await params).id, { kind: q.get("kind") ?? undefined, q: q.get("q") ?? undefined, tag: q.get("tag") ?? undefined, deleted: q.get("deleted") === "1" }));
});

/**
 * A raw-body upload: the file's bytes are the request body and its name is in
 * `?filename=`. Not multipart, because multipart parsing buffers, and this has
 * to handle files bigger than memory. `?folder=` is the Yarn folder it goes in.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const s = store();
  s.getProject(id);
  const q = new URL(req.url).searchParams;
  const filename = q.get("filename") ?? "";
  if (!filename) return fail(400, "validation", "Say what the file is called: add ?filename= to the request.");
  const folder = cleanFolder(q.get("folder"));
  const tmp = uploadTempPath(s, id);
  try {
    await bodyToFile(req, tmp, s.getSetting("yarn.maxBytes", DEFAULT_MAX_BYTES));
  } catch (e) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    throw e;
  }
  const r = await importYarn(s, id, tmp, filename, { folder });
  return ok(r, r.existing ? 200 : 201);
});
