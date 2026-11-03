import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
export const GET = route(async (_: Request, { params }: { params: Promise<{ id: string }> }) => ok(store().listJobs({ projectId: (await params).id, limit: 30 })));
