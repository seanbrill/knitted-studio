// What the social routes share: the scheduler, started with the first route that needs it
// if the server's start did not already (instrumentation.ts), and this server's port, which
// the platforms that come back to this computer come back to.

import { startScheduler } from "@knitted/social";
import { store } from "./server";

/** Look for posts that are due now, as after Post now, rather than at the next tick. */
export function kick() {
  void startScheduler(store()).kick();
}

/** This server's port, from the address it was asked at: the desktop app picks one each launch. */
export function portOf(req: Request): number {
  const host = req.headers.get("host") ?? "";
  const m = host.match(/:(\d+)$/);
  return m ? Number(m[1]) : Number(process.env.PORT || 80);
}
