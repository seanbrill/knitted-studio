import { z } from "zod";
import { importYarnFromUrl } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const b = await body(req, z.object({ url: z.string().max(2000), folder: z.string().max(400).optional(), shelf: z.enum(["yarn", "reference"]).optional() }));
  return ok(await importYarnFromUrl(store(), (await params).id, b.url, { folder: b.folder, shelf: b.shelf }), 201);
});
