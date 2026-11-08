import { duplicateDesign } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

export const POST = route(async (_: Request, { params }: { params: Promise<{ did: string }> }) => ok(duplicateDesign(store(), (await params).did), 201));
