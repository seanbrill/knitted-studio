import { backupNow, listBackups } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

const view = (b: { name: string; bytes: number; createdAt: string; kind: string }) => ({ name: b.name, bytes: b.bytes, createdAt: b.createdAt, kind: b.kind });

export const GET = route(() => ok(listBackups(store().paths.root).map(view)));
export const POST = route(() => { const s = store(); return ok(view(backupNow(s.db, s.paths.root, "manual")), 201); });
