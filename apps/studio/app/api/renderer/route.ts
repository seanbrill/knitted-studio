import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fail, ok, route } from "@/lib/server";

export const dynamic = "force-dynamic";

// The desktop app does not ship a 150MB browser. Knitting needs one, so the first
// time someone knits we ask, and download it only when they say yes. The location
// is PLAYWRIGHT_BROWSERS_PATH, which the shell points at the user's own data folder.
const g = globalThis as unknown as { __rendererInstall?: { state: "running" | "done" | "failed"; log: string } };

async function available() {
  try {
    const { chromium } = await import(/* webpackIgnore: true */ "playwright");
    return existsSync(chromium.executablePath());
  } catch { return false; }
}

export const GET = route(async () => ok({ ready: await available(), install: g.__rendererInstall ?? null }));

export const POST = route(async () => {
  if (g.__rendererInstall?.state === "running") return ok(g.__rendererInstall, 202);
  let cli: string;
  try { cli = createRequire(import.meta.url).resolve("playwright/cli"); } catch { return fail(500, "renderer", "This build has no browser installer. Reinstall knitted from the download page."); }
  const state = (g.__rendererInstall = { state: "running" as const, log: "" }) as { state: "running" | "done" | "failed"; log: string };
  const child = spawn(process.execPath, [cli, "install", "chromium-headless-shell"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  const keep = (d: Buffer) => { state.log = (state.log + d).slice(-2000); };
  child.stdout.on("data", keep); child.stderr.on("data", keep);
  child.on("close", (code) => { state.state = code === 0 ? "done" : "failed"; });
  child.on("error", (e) => { state.state = "failed"; state.log = String(e); });
  return ok(state, 202);
});
