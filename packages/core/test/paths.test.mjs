import assert from "node:assert/strict";
import test from "node:test";
import { isAbsolute, join, relative } from "node:path";
import { homedir } from "node:os";
import { paths } from "../src/paths.ts";

test("KNITTED_HOME overrides the location", () => {
  const p = paths({ KNITTED_HOME: "/data/knitted" });
  assert.equal(p.root, "/data/knitted");
  assert.equal(p.db, join("/data/knitted", "knitted.db"));
  assert.equal(p.projectsDir, join("/data/knitted", "projects"));
});

test("without an override it uses ~/.knitted-studio", () => {
  assert.equal(paths({}).root, join(homedir(), ".knitted-studio"));
});

test("an empty KNITTED_HOME is treated as unset, not as the current directory", () => {
  assert.equal(paths({ KNITTED_HOME: "" }).root, join(homedir(), ".knitted-studio"));
});

test("every per-project location sits under the project, under the root", () => {
  const p = paths({ KNITTED_HOME: "/data/knitted" });
  for (const dir of [p.projectDir("pj_1"), p.yarnDir("pj_1"), p.outDir("pj_1")]) {
    assert.ok(isAbsolute(dir));
    assert.ok(!relative(p.projectsDir, dir).startsWith(".."), `${dir} escapes the projects dir`);
  }
  assert.equal(relative(p.projectDir("pj_1"), p.yarnDir("pj_1")), "yarn");
  assert.equal(relative(p.projectDir("pj_1"), p.outDir("pj_1")), "knits");
});
