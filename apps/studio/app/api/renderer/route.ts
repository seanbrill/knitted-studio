import { browserProblem, installBrowser } from "@knitted/engine";
import { ok, route } from "@/lib/server";

export const dynamic = "force-dynamic";

// The desktop app does not ship the browser knitting draws with (about 100 MB), so
// Settings, About asks, and this downloads it only when the person says yes
// (installBrowser, in the engine). One download at a time, remembered while the server runs.
type Install = { state: "running" | "done" | "failed"; progress: number | null; error?: string };
const g = globalThis as unknown as { __rendererInstall?: Install; __rendererReady?: boolean };
const clause = (s: string) => s.trim().replace(/\.$/, "");

async function ready() {
  if (g.__rendererReady) return true;
  if (g.__rendererInstall?.state === "running") return false;
  return (g.__rendererReady = !(await browserProblem()));
}

export const GET = route(async () => ok({ ready: await ready(), install: g.__rendererInstall ?? null }));

export const POST = route(async () => {
  if (g.__rendererInstall?.state === "running") return ok(g.__rendererInstall, 202);
  const state: Install = (g.__rendererInstall = { state: "running", progress: null });
  installBrowser({ onProgress: (p: number) => { state.progress = p; } }).then(
    async () => {
      // Installed is not the same as working: say why if it will not start.
      const problem = await browserProblem();
      if (!problem) { g.__rendererReady = true; state.state = "done"; state.progress = 1; }
      else { state.state = "failed"; state.error = `The browser downloaded but would not start: ${clause(problem)}.`; }
    },
    (e: unknown) => {
      state.state = "failed";
      state.error = `The download did not finish: ${clause(String((e as Error)?.message ?? e))}. Check your internet connection and try again.`;
    },
  );
  return ok(state, 202);
});
