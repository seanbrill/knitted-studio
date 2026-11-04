// The last step of a release: the site. It is static and lists the release folder as it
// was when it was built, and the pipeline in EZPIPELINE builds it on every push to main.
// The installers were just built from this checkout, so its commits are what the site
// should show: push them, which starts that build, and wait until the Download page lists
// the version. Only a push starts the build, so with nothing to push it says what will.

import { spawnSync } from "node:child_process";

const BY_HAND = `Run "knitted release" in EZPIPELINE: once it has run, the page lists it and copies older than 0.1.2 are offered it.`;

/** What went wrong in a push, from git's own lines: the error, not the hints after it. */
function pushProblem(stderr) {
  const lines = String(stderr).split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => l.includes("[rejected]"))) return "main on origin has commits this checkout does not, so git refused it";
  return (lines.find((l) => /^(fatal|error):/.test(l)) ?? lines[0] ?? "git said nothing").replace(/^(fatal|error):\s*/, "").replace(/[.\s]+$/, "");
}

/** Get `version` onto the site's Download page. Returns what to tell the person; `log` says what it is doing meanwhile. */
export async function showOnSite({ root, site, version, fetch = globalThis.fetch, waitMs = 15 * 60_000, everyMs = 20_000, log = console.log }) {
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const listed = () => fetch(`${site}/releases.json?at=${Date.now()}`, { signal: AbortSignal.timeout(20_000) })
    .then((res) => (res.ok ? res.json() : null))
    .then((s) => Array.isArray(s?.releases) && s.releases.some((r) => r?.version === version))
    .catch(() => false);

  if (git("status", "--porcelain", "--untracked-files=no").stdout.trim()) log("release: this checkout has changes that are not committed. The installers have them, and the site gets them once they are committed and pushed.");
  if (await listed()) return "the Download page lists it already.";
  const ahead = Number(git("rev-list", "--count", "origin/main..HEAD").stdout.trim() || 0);
  if (!ahead) return `the Download page does not list it yet, and this checkout has nothing to push, so nothing will start a site build. ${BY_HAND}`;
  const branch = git("branch", "--show-current").stdout.trim();
  if (branch !== "main") return `the Download page does not list it yet. This checkout is on ${branch || "no branch"}, not main: put it on main and push, and the site build that starts lists it.`;
  const push = git("push", "--quiet", "origin", "main");
  if (push.status !== 0) return `the push to main did not succeed, so no site build has started: ${pushProblem(push.stderr)}. Push main once that is fixed, and the build that starts lists it.`;
  log(`release: pushed ${ahead} commit${ahead === 1 ? "" : "s"} to main, which starts the site build. Waiting for the Download page to list ${version}: it takes a few minutes.`);
  for (const end = Date.now() + waitMs; Date.now() < end; ) {
    await new Promise((r) => setTimeout(r, everyMs));
    if (await listed()) return `the Download page lists ${version}, and copies older than 0.1.2 are offered it.`;
  }
  return `the Download page does not list ${version} yet, ${Math.round(waitMs / 60_000)} minutes after the push. Its build is "knitted release" in EZPIPELINE, and its log there says how it went.`;
}
