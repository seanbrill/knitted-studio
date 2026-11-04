// The browser knitting draws with: the desktop app downloads it when someone presses
// Download it, with Playwright's own installer, from inside the built server.
//
// The built server sits inside the repo, so Node would quietly find a package the build
// left out in the repo's node_modules instead. These tests ask where each one comes from.

import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { browserInstaller, installerError } from "@knitted/engine";

const server = resolve("dist/app"), built = existsSync(join(server, "apps/studio/server.js"));

test("the installer is found from the server's folder up, the way Node finds a package", () => {
  assert.equal(browserInstaller(resolve("apps/studio")), resolve("node_modules/playwright-core/cli.js"));
  const empty = mkdtempSync(join(tmpdir(), "knitted-no-installer-"));
  try { assert.equal(browserInstaller(empty), null); } finally { rmSync(empty, { recursive: true }); }
});

test("a failed download says what went wrong, not only that it failed", () => {
  // The installer's own output with no connection, cut short: it retries, then wraps the cause.
  const refused = [
    "Downloading Chrome Headless Shell 156.0.8078.4 (playwright chromium-headless-shell v1248)\x1b[2m from http://127.0.0.1:9/builds/cft/156.0.8078.4/mac-arm64/chrome-headless-shell-mac-arm64.zip\x1b[22m",
    "Error: connect ECONNREFUSED 127.0.0.1:9",
    "    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1637:16) {",
    "  errno: -61,",
    "  code: 'ECONNREFUSED',",
    "}",
    "Failed to install browsers",
    "Error: Failed to download Chrome Headless Shell 156.0.8078.4 (playwright chromium-headless-shell v1248), caused by",
    "Error: Download failure, code=1",
    "    at ChildProcess.<anonymous> (/Applications/knitted.app/Contents/Resources/app-server/node_modules/playwright-core/lib/coreBundle.js:33774:32)",
    "    at ChildProcess._handle.onexit (node:internal/child_process:294:12)",
  ].join("\n");
  assert.equal(installerError(refused, 1), "connect ECONNREFUSED 127.0.0.1:9");
  assert.equal(installerError("Failed to install browsers\nError: Download failure, code=1\n", 1), "Download failure, code=1", "only the wrapper is better than nothing");
  assert.equal(installerError("", 9), "The installer stopped (9)");
});

test("the built server carries Playwright itself, so knitting starts in the desktop app", { skip: !built && "no build: npm run build:app" }, () => {
  // The engine imports it at run time, out of the tracer's sight (next.config.mjs).
  const found = createRequire(join(server, "apps/studio/server.js")).resolve("playwright");
  assert.ok(found.startsWith(join(server, "node_modules/playwright/")), `playwright came from ${found}, outside the built server`);
});

test("the built server carries the installer, and it runs", { skip: !built && "no build: npm run build:app" }, () => {
  const cli = browserInstaller(join(server, "apps/studio"));
  assert.equal(cli, join(server, "node_modules/playwright-core/cli.js"));
  assert.ok(existsSync(join(server, "node_modules/playwright-core/lib/entry/oopBrowserDownload.js")), "the installer downloads in a process of its own, from this file");
  const browsers = mkdtempSync(join(tmpdir(), "knitted-browsers-"));
  try {
    const plan = execFileSync(process.execPath, [cli, "install", "--dry-run", "chromium-headless-shell"], { encoding: "utf8", env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers } });
    assert.match(plan, /Chrome Headless Shell/);
    assert.ok(plan.includes(browsers), "it would install where the desktop app points it");
  } finally { rmSync(browsers, { recursive: true }); }
});
