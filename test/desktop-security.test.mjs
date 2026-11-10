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
const send = (path, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: "127.0.0.1", port, path, method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers } }, (res) => {
    let text = "";
    res.setEncoding("utf8"); res.on("data", (d) => (text += d));
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, json: () => JSON.parse(text) }));
  });
  req.on("error", reject); req.end(body === undefined ? undefined : JSON.stringify(body));
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

// ── The MCP address: Claude Code and other MCP clients get in with its key instead ──
const address = async () => (await send("/api/agent/mcp", { headers: { "x-knitted-token": TOKEN } })).json().path;
const rpc = (method, params) => ({ jsonrpc: "2.0", id: 1, method, params });
const mcpPost = (path, body, headers = {}) => send(path, { method: "POST", body, headers });

test("only the window is given the MCP address", opts, async () => {
  assert.equal((await send("/api/agent/mcp")).status, 401);
  assert.match(await address(), /^\/api\/mcp\/[\w-]{32}$/);
});
test("an MCP client gets in at the address with no launch token, and talks MCP", opts, async () => {
  const mcp = await address();
  const init = await mcpPost(mcp, rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }));
  assert.equal(init.status, 200);
  assert.equal(init.json().result.serverInfo.name, "knitted-studio");
  assert.equal((await mcpPost(mcp, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202, "a notification gets no reply");
  assert.ok((await mcpPost(mcp, rpc("tools/list"))).json().result.tools.some((t) => t.name === "list_projects"));
  const call = (await mcpPost(mcp, rpc("tools/call", { name: "list_projects", arguments: {} }))).json().result;
  assert.ok(Array.isArray(JSON.parse(call.content[0].text)));
});
test("a session names the tools it was given, and one given another knitted's is told to reconnect", opts, async () => {
  const mcp = await address();
  const init = await mcpPost(mcp, rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }));
  const id = init.headers["mcp-session-id"];
  assert.match(id, /^[\x21-\x7e]+\.[0-9a-f]{12}\.[0-9a-f]{12}$/);
  const call = (session) => mcpPost(mcp, rpc("tools/call", { name: "list_projects", arguments: {} }), session ? { "mcp-session-id": session } : {});
  assert.equal((await call(id)).json().result.content.length, 1, "this knitted's tools: nothing more to say");
  assert.equal((await call()).json().result.content.length, 1, "no session: answered as before");
  assert.equal((await call(id)).headers["mcp-session-id"], undefined, "a session keeps its name until it reconnects");
  const old = "0.1.1.0123456789ab.0123456789ab";
  const told = (await call(old)).json().result.content;
  assert.ok(Array.isArray(JSON.parse(told[0].text)), "the result itself, first");
  assert.match(told.at(-1).text, /updated since you connected: .*those of 0\.1\.1.*reconnect knitted \(in Claude Code, \/mcp, then Reconnect\)/);
  assert.equal((await mcpPost(mcp, rpc("tools/list"), { "mcp-session-id": old })).status, 200, "nothing is refused");
});
test("a wrong key, a web page, a foreign Host or a GET does not get in", opts, async () => {
  const mcp = await address();
  assert.equal((await mcpPost(mcp.replace(/.$/, (c) => (c === "a" ? "b" : "a")), rpc("tools/list"))).status, 404);
  assert.equal((await mcpPost("/api/mcp/short", rpc("tools/list"))).status, 404);
  assert.equal((await mcpPost("/api/mcp", rpc("tools/list"))).status, 401, "no key is no way round the gate");
  assert.equal((await mcpPost(mcp, rpc("tools/list"), { origin: "https://evil.example" })).status, 403);
  assert.equal((await mcpPost(mcp, rpc("tools/list"), { host: "evil.example" })).status, 421);
  assert.equal((await send(mcp)).status, 405);
});
test("a new address shuts the old one", opts, async () => {
  const old = await address();
  const fresh = (await send("/api/agent/mcp", { method: "POST", headers: { "x-knitted-token": TOKEN }, body: {} })).json().path;
  assert.notEqual(fresh, old);
  assert.equal((await mcpPost(old, rpc("tools/list"))).status, 404);
  assert.equal((await mcpPost(fresh, rpc("tools/list"))).status, 200);
});
