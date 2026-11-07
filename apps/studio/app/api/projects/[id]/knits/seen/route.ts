import { markAllKnitsSeen } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
/** Every knit in the project, seen: their New badges go. */
export const POST = route(async (_: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = (await params).id;
  store().getProject(id);
  return ok({ marked: markAllKnitsSeen(store(), id) });
});
