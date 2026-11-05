// The version goes up by itself: a push to main that changes the app gets the next one
// (scripts/version-bump.mjs, run by .github/workflows/version.yml). In throwaway repos.

import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { commit, NOT_THE_APP, nextVersion, plan } from "../scripts/version-bump.mjs";
import { ROOT } from "./lib/scan.mjs";

const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
const json = (root, file) => JSON.parse(readFileSync(join(root, file), "utf8"));
const save = (root, message, files) => { for (const [f, t] of Object.entries(files)) put(root, f, t); git(root, "add", "-A"); git(root, "commit", "--quiet", "-m", message); };
const pretty = (v) => `${JSON.stringify(v, null, 2)}\n`;

/** A repo at 0.1.4, as the real one is laid out. */
function repo() {
  const root = mkdtempSync(join(tmpdir(), "knitted-version-"));
  git(root, "init", "--quiet", "-b", "main");
  git(root, "config", "user.name", "Test"); git(root, "config", "user.email", "test@example.com");
  save(root, "0.1.4", {
    "package.json": pretty({ name: "knitted-studio", version: "0.1.4", workspaces: ["apps/*"] }),
    "apps/studio/package.json": pretty({ name: "@knitted/studio", version: "0.1.4", dependencies: { next: "15" } }),
    "package-lock.json": pretty({ name: "knitted-studio", version: "0.1.4", lockfileVersion: 3, packages: { "": { name: "knitted-studio", version: "0.1.4" }, "apps/studio": { name: "@knitted/studio", version: "0.1.4" }, "node_modules/next": { version: "15.0.0" } } }),
    "apps/site/content/changelog.json": pretty({ note: "Newest first.", entries: [{ version: "0.1.4", date: "2026-11-04", title: "Folders", items: ["Folders."] }] }),
    "apps/studio/app.ts": "export const a = 1;\n",
  });
  return root;
}

test("only the docs, the site, tests or CI changed: the version stays", () => {
  const root = repo();
  save(root, "Docs", { "docs/user/x.md": "x", "apps/site/app/page.tsx": "x", "test/a.test.mjs": "x", "packages/core/test/b.test.mjs": "x", "ci/p.yaml": "x", "README.md": "x", "scripts/release.mjs": "x" });
  assert.equal(plan(root).next, null);
});

test("the app changed: the next patch, with an entry listing what changed, as one commit", () => {
  const root = repo();
  save(root, "Docs only", { "docs/user/x.md": "x" });
  save(root, "Ask: a chat \u2014 with your model", { "apps/studio/app.ts": "export const a = 2;\n" });
  save(root, "Core too", { "packages/core/src/x.ts": "x" });
  const p = plan(root, { today: "2026-11-05" });
  assert.equal(p.next, "0.1.5");
  assert.deepEqual(p.changes.map((c) => c.subject), ["Ask: a chat \u2014 with your model", "Core too"], "the docs commit is not one of them");
  assert.deepEqual(p.entry, { version: "0.1.5", date: "2026-11-05", title: "Fixes and improvements", items: ["Ask: a chat, with your model", "Core too"] }, "no em dash reaches the changelog");

  commit(root, p);
  assert.equal(git(root, "log", "-1", "--format=%s"), "0.1.5");
  assert.equal(git(root, "status", "--porcelain"), "", "every file it changed is in the commit");
  assert.equal(json(root, "package.json").version, "0.1.5");
  assert.equal(json(root, "apps/studio/package.json").version, "0.1.5");
  const lock = json(root, "package-lock.json");
  assert.deepEqual([lock.version, lock.packages[""].version, lock.packages["apps/studio"].version, lock.packages["node_modules/next"].version], ["0.1.5", "0.1.5", "0.1.5", "15.0.0"]);
  assert.deepEqual(json(root, "apps/site/content/changelog.json").entries.map((e) => e.version), ["0.1.5", "0.1.4"]);
  assert.equal(plan(root).next, null, "and once it is set, there is nothing more to do");
  assert.match(git(root, "log", "-1", "--format=%b"), /The app changed since 0\.1\.4, in 2 commits:\n\n[0-9a-f]{7} Ask: a chat/);
});

test("the changelog's next entry is the one used, and may pick a bigger number", () => {
  const root = repo();
  const log = json(root, "apps/site/content/changelog.json");
  save(root, "Notes", { "apps/site/content/changelog.json": pretty({ ...log, next: { version: "0.2.0", title: "Ask your model", items: ["Ask is a chat."] } }) });
  save(root, "Ask", { "apps/studio/app.ts": "export const a = 3;\n" });
  const p = plan(root, { today: "2026-11-05" });
  assert.equal(p.next, "0.2.0");
  assert.deepEqual(p.entry, { version: "0.2.0", date: "2026-11-05", title: "Ask your model", items: ["Ask is a chat."] });
  commit(root, p);
  const after = json(root, "apps/site/content/changelog.json");
  assert.equal(after.next, undefined, "the notes are used once");
  assert.deepEqual(Object.keys(after), ["note", "entries"]);

  save(root, "Backwards", { "apps/site/content/changelog.json": pretty({ ...after, next: { version: "0.1.9", title: "x", items: ["x"] } }), "apps/studio/app.ts": "export const a = 4;\n" });
  assert.throws(() => plan(root), /0\.1\.9, which is not newer than 0\.2\.0/);
});

test("a push that sets the version itself is left alone", () => {
  const root = repo();
  const log = json(root, "apps/site/content/changelog.json");
  save(root, "1.0.0", {
    "apps/studio/app.ts": "export const a = 5;\n",
    "package.json": pretty({ ...json(root, "package.json"), version: "1.0.0" }),
    "apps/studio/package.json": pretty({ ...json(root, "apps/studio/package.json"), version: "1.0.0" }),
    "apps/site/content/changelog.json": pretty({ ...log, entries: [{ version: "1.0.0", date: "2026-11-05", title: "One", items: ["x"] }, ...log.entries] }),
  });
  assert.equal(plan(root).next, null);
  save(root, "A dependency", { "apps/studio/package.json": pretty({ ...json(root, "apps/studio/package.json"), dependencies: { next: "16" } }) });
  assert.equal(plan(root).next, "1.0.1", "a change to the app's package.json that is not its version is a change to the app");
});

test("the next version after each kind", () => {
  assert.equal(nextVersion("0.1.9"), "0.1.10");
  assert.equal(nextVersion("0.2.0-beta.1"), "0.2.0-beta.2");
  assert.throws(() => nextVersion("1.0"), /not a version this can count on from/);
});

test("each path said not to be the app is in the repository, so none is a typo", () => {
  for (const glob of NOT_THE_APP) {
    assert.notEqual(git(ROOT, "ls-files", "--cached", "--others", "--exclude-standard", "--", `:(glob)${glob}`), "", `${glob} matches nothing here`);
  }
});

test("the workflow gives it the whole history and pushes what it commits", () => {
  const yml = readFileSync(join(ROOT, ".github/workflows/version.yml"), "utf8");
  assert.match(yml, /branches: \[main\]/);
  assert.match(yml, /fetch-depth: 0/);
  assert.match(yml, /contents: write/);
  assert.match(yml, /node scripts\/version-bump\.mjs --commit/);
  assert.match(yml, /git push --quiet origin HEAD:main/);
});
