// End-to-end harness: the real studio, a real browser, a throwaway library.
//
// Starts `next dev` on a free port with KNITTED_HOME pointed at a temp dir, so a
// test can create projects and upload files without touching anyone's real
// library, and tears it all down after. Run with `npm run test:e2e`; kept out
// of `npm test` because it needs Chromium installed.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../lib/scan.mjs";

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

export async function startStudio({ prod = false, env: extra = {} } = {}) {
  const home = await mkdtemp(join(tmpdir(), "knitted-e2e-"));
  const port = await freePort();
  const env = { ...process.env, KNITTED_HOME: home, PORT: String(port), HOSTNAME: "127.0.0.1", NEXT_TELEMETRY_DISABLED: "1", ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  // `detached` makes the server the leader of its own process group, so stop()
  // can kill the group. `next dev` spawns a `next-server` child, and killing only
  // the parent orphans it: every run leaked a server, and after a dozen runs the
  // machine was at load 23 and every test took a minute.
  const child = prod
    ? spawn(process.execPath, [join(ROOT, "dist/app/apps/studio/server.js")], { env, stdio: ["ignore", "pipe", "pipe"], detached: true })
    : spawn(process.execPath, [join(ROOT, "node_modules/next/dist/bin/next"), "dev", "-p", String(port), "-H", "127.0.0.1"], {
        cwd: join(ROOT, "apps/studio"), env, stdio: ["ignore", "pipe", "pipe"], detached: true,
      });
  const killGroup = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} } };
  process.once("exit", killGroup);
  let log = "";
  child.stdout.on("data", (d) => (log = (log + d).slice(-4000)));
  child.stderr.on("data", (d) => (log = (log + d).slice(-4000)));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`studio exited early\n${log}`);
    try { if ((await fetch(`${url}/api/health`)).ok) break; } catch {}
    if (Date.now() > deadline) { killGroup(); throw new Error(`studio did not start\n${log}`); }
    await new Promise((r) => setTimeout(r, 300));
  }
  return {
    url, home, log: () => log,
    async stop() {
      killGroup();
      child.stdout.destroy();
      child.stderr.destroy();
      await rm(home, { recursive: true, force: true });
    },
  };
}

export async function launchBrowser() {
  const { chromium } = await import("playwright");
  return chromium.launch();
}

/** Serious and critical axe violations on the current page, as readable strings. */
export async function axeProblems(page) {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.help} [${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}]`);
}
