// The local gate: in the desktop app the server listens on 127.0.0.1, which any program
// or web page on the machine can reach. Without the launch token, none of them get in.
// Needs `npm run build:app` first; skipped (loudly) when there is no build.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const server = join(process.cwd(), "dist/app/apps/studio/server.js");
const built = existsSync(server);
const TOKEN = "t".repeat(64);
let child, port;

const free = () => new Promise((r) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
// node:http, not fetch, because fetch refuses to let a test lie about the Host header.
const get = (path, headers = {}) => new Promise((resolve, reject) => {
  const req = request({ host: "127.0.0.1", port, path, headers }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
  req.on("error", reject); req.end();
});

before(async () => {
  if (!built) return;
  port = await free();
  child = spawn(process.execPath, [server], {
    cwd: join(process.cwd(), "dist/app/apps/studio"), stdio: "ignore",
    env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", KNITTED_API_TOKEN: TOKEN, KNITTED_HOME: await mkdtemp(join(tmpdir(), "knitted-sec-")) },
  });
  for (let i = 0; i < 100; i++) { try { await get("/api/health", { "x-knitted-token": TOKEN }); return; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  throw new Error("server did not start");
});
after(() => child?.kill("SIGKILL"));

const opts = { skip: built ? false : "run `npm run build:app` first" };
test("a request with no token is refused", opts, async () => assert.equal(await get("/api/projects"), 401));
test("a request with the wrong token is refused", opts, async () => assert.equal(await get("/api/projects", { "x-knitted-token": "nope" }), 401));
test("pages are gated too, not only the API", opts, async () => assert.equal(await get("/"), 401));
test("the right token, as a cookie or a header, is let in", opts, async () => {
  assert.equal(await get("/api/projects", { cookie: `knitted_token=${TOKEN}` }), 200);
  assert.equal(await get("/api/projects", { "x-knitted-token": TOKEN }), 200);
});
test("a foreign Host header (DNS rebinding) is refused even with the token", opts, async () => {
  assert.equal(await get("/api/projects", { host: "evil.example", "x-knitted-token": TOKEN }), 421);
});
