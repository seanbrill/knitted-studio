import { listAccounts } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok(listAccounts(store())));
