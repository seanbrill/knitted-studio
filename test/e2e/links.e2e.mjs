// Links, read by the BUILT server. Every import from a link once failed in the desktop
// app ("Transform is not a constructor") because the bundler, not Node, decides what
// `await import("node:stream")` returns, and every test of the happy path ran on source.
// So this runs dist/app, as the desktop app does. The only stand-in is the network:
// fixtures/public-net.mjs answers for one public address, and the guard stays on.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../lib/scan.mjs";
import { startStudio } from "./harness.mjs";

let studio, projectId;
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  assert.ok(existsSync(join(ROOT, "dist/app/apps/studio/server.js")), "This tests the built server: run npm run build:app first.");
  const net = pathToFileURL(join(import.meta.dirname, "fixtures/public-net.mjs")).href;
  studio = await startStudio({ prod: true, env: { NODE_OPTIONS: `--import=${net}` } });
  projectId = (await j("POST", "/api/projects", { name: "Links" })).body.id;
});
after(async () => { await studio?.stop(); });

test("a picture comes in from a link, named as the link spells it", async () => {
  const r = await j("POST", `/api/projects/${projectId}/yarn/url`, { url: "https://203.0.113.9/Hero%20photo.png" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.yarn.kind, "image");
  assert.equal(r.body.yarn.name, "Hero photo");
});

test("a website becomes a proposal, then a swatch with its icon in Yarn", async () => {
  const p = await j("POST", `/api/projects/${projectId}/swatches/from-url`, { url: "203.0.113.9" });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const hex = (role) => p.body.colors.find((c) => c.role === role)?.hex;
  assert.deepEqual([hex("primary"), hex("background"), hex("text")], ["#b16cf8", "#150829", "#ffffff"]);
  assert.deepEqual(p.body.logo, { url: "https://203.0.113.9/icon.png", use: "mark" });
  assert.deepEqual([p.body.matched.display, p.body.matched.body], [{ family: "Fraunces", from: "bundled" }, { family: "Inter", from: "bundled" }]);
  const s = await j("POST", `/api/projects/${projectId}/swatches/from-site`, { name: p.body.name, colors: p.body.colors.map(({ role, name, hex: h }) => ({ role, name, hex: h })), fonts: p.body.fontRoles, logo: p.body.logo });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.deepEqual(s.body.notes, []);
  assert.equal(s.body.swatch.logos.length, 1, "the icon came in as Yarn");
  const project = (await j("GET", `/api/projects/${projectId}`)).body;
  assert.notEqual(project.swatchId, s.body.swatch.id, "a new swatch waits for Use for this project");
});

test("the built server still refuses a link to this computer", async () => {
  const r = await j("POST", `/api/projects/${projectId}/yarn/url`, { url: "http://127.0.0.1:9/x.png" });
  assert.equal(r.status, 400);
  assert.match(r.body.error.message, /your own computer or network/);
});
