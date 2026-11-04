// The release's last step, against real git repositories and a stand-in for the site. A
// release pushes the checkout its installers were built from, since a push to main is what
// starts the site build, and waits for the Download page to list the version. A release
// run with nothing new to push once left the page a version behind until someone noticed.

import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { showOnSite } from "../scripts/release-site.mjs";

// No one's own git settings (signing, hooks) reach these repositories, and every commit has an author.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" });
const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A checkout `ahead` commits past its origin's main, as a release leaves one. */
function checkout(ahead) {
  const dir = mkdtempSync(join(tmpdir(), "knitted-release-site-"));
  const origin = join(dir, "origin.git"), work = join(dir, "work");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  git(dir, "init", "-q", "-b", "main", work);
  const commit = (cwd, n) => { writeFileSync(join(cwd, "f.txt"), String(n)); git(cwd, "add", "f.txt"); git(cwd, "commit", "-q", "-m", `change ${n}`); };
  commit(work, 0);
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "-q", "-u", "origin", "main");
  for (let i = 1; i <= ahead; i++) commit(work, i);
  return { dir, work, origin, commit, originMain: () => git(origin, "rev-parse", "main"), head: () => git(work, "rev-parse", "HEAD") };
}

/** The site: its releases.json lists what `has()` says at the moment it is asked. */
async function site(has) {
  const server = createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ releases: has().map((version) => ({ version })) })); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const quick = { version: "0.1.3", everyMs: 20, waitMs: 3000 };

test("a release with commits to push pushes them, and waits for the Download page to list it", async () => {
  const c = checkout(2);
  // The pipeline: once main has the release's commits, the site it builds lists the version.
  const s = await site(() => (c.originMain() === c.head() ? ["0.1.3", "0.1.2"] : ["0.1.2"]));
  const said = [];
  try {
    const out = await showOnSite({ ...quick, root: c.work, site: s.url, log: (m) => said.push(m) });
    assert.equal(c.originMain(), c.head(), "main was pushed");
    assert.match(said.join("\n"), /pushed 2 commits to main, which starts the site build/);
    assert.equal(out, "the Download page lists 0.1.3, and copies older than 0.1.2 are offered it.");
  } finally { s.close(); }
});

test("with nothing to push, it says what will start the site build, and that the installers hold uncommitted changes", async () => {
  const c = checkout(0);
  writeFileSync(join(c.work, "f.txt"), "not committed");
  const s = await site(() => ["0.1.2"]);
  const said = [];
  try {
    const out = await showOnSite({ ...quick, root: c.work, site: s.url, log: (m) => said.push(m) });
    assert.match(out, /nothing to push, so nothing will start a site build\. Run "knitted release" in EZPIPELINE/);
    assert.match(said.join("\n"), /changes that are not committed\. The installers have them/);
  } finally { s.close(); }
});

test("a version the Download page lists already needs no push", async () => {
  const c = checkout(1);
  const before = c.originMain();
  const s = await site(() => ["0.1.3"]);
  try {
    assert.equal(await showOnSite({ ...quick, root: c.work, site: s.url, log: () => {} }), "the Download page lists it already.");
    assert.equal(c.originMain(), before);
  } finally { s.close(); }
});

test("a checkout on another branch is not pushed to main", async () => {
  const c = checkout(1);
  git(c.work, "checkout", "-q", "-b", "spring");
  const before = c.originMain();
  const s = await site(() => ["0.1.2"]);
  try {
    assert.match(await showOnSite({ ...quick, root: c.work, site: s.url, log: () => {} }), /This checkout is on spring, not main: put it on main and push/);
    assert.equal(c.originMain(), before);
  } finally { s.close(); }
});

test("a push main refuses is said, with git's reason, and nothing waits on it", async () => {
  const c = checkout(1);
  const other = join(c.dir, "other");
  git(c.dir, "clone", "-q", "-b", "main", c.origin, other);
  c.commit(other, 9);
  git(other, "push", "-q", "origin", "main");
  const s = await site(() => ["0.1.2"]);
  try {
    assert.match(await showOnSite({ ...quick, root: c.work, site: s.url, log: () => {} }), /^the push to main did not succeed, so no site build has started: main on origin has commits this checkout does not, so git refused it\. Push main once that is fixed/);
  } finally { s.close(); }
});

test("a site that never lists it is waited for only so long, and the message says where to look", async () => {
  const c = checkout(1);
  const s = await site(() => ["0.1.2"]);
  try {
    const out = await showOnSite({ ...quick, waitMs: 200, root: c.work, site: s.url, log: () => {} });
    assert.equal(c.originMain(), c.head(), "it pushed, then waited");
    assert.match(out, /does not list 0\.1\.3 yet, \d+ minutes after the push\. Its build is "knitted release" in EZPIPELINE/);
  } finally { s.close(); }
});
