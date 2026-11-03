import { z } from "zod";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

export const GET = route((req: Request) => {
  const q = new URL(req.url).searchParams;
  return ok(store().listProjects({ archived: q.get("archived") === "1", deleted: q.get("deleted") === "1" }));
});

const Create = z.object({ name: z.string(), description: z.string().optional(), starter: z.enum(["blank", "social"]).optional() });
export const POST = route(async (req: Request) => ok(store().createProject(await body(req, Create)), 201));
