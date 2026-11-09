// The last step of a release: the site's list. The Download page reads the release folder
// in the visitor's browser, so it shows a version once it is up; but the site is static, and
// the list built into it (what the page shows first, and /releases.json, which copies older
// than 0.1.2 read) is the folder as it was when the site was built. The pipeline in EZPIPELINE
// builds it on every push to main. The installers were just built from this checkout, so its
// commits are what the site should show: push them, which starts that build, and wait until
// the site's list has the version. Only a push starts the build, so with nothing to push it says what will.
// Given the SHA256SUMS.txt that went up, it waits for those files: a version the page lists
// from an earlier upload (the pipeline's, without the .dmg) is not this one.

import { spawnSync } from "node:child_process";

const BY_HAND = `Run "knitted release" in EZPIPELINE: once it has run, the site's list has it and copies older than 0.1.2 are offered it.`;

/** What went wrong in a push, from git's own lines: the error, not the hints after it. */
function pushProblem(stderr) {
  const lines = String(stderr).split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => l.includes("[rejected]"))) return "main on origin has commits this checkout does not, so git refused it";
  return (lines.find((l) => /^(fatal|error):/.test(l)) ?? lines[0] ?? "git said nothing").replace(/^(fatal|error):\s*/, "").replace(/[.\s]+$/, "");
}

/** The installers a SHA256SUMS.txt names, each with its SHA-256. */
const sumsIn = (text) => [...String(text).matchAll(/^([0-9a-f]{64}) [ *](.+)$/gim)].map((m) => ({ sha256: m[1].toLowerCase(), name: m[2].trim() }));

/**
 * Get `version` into the site's list: with `sums`, the files in that
 * SHA256SUMS.txt. Returns what to tell the person; `log` says what it is doing meanwhile.
 */
export async function showOnSite({ root, site, version, sums = "", fetch = globalThis.fetch, waitMs = 15 * 60_000, everyMs = 20_000, log = console.log }) {
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const want = sumsIn(sums);
  const onPage = () => fetch(`${site}/releases.json?at=${Date.now()}`, { signal: AbortSignal.timeout(20_000) })
    .then((res) => (res.ok ? res.json() : null))
    .then((s) => (Array.isArray(s?.releases) && s.releases.find((r) => r?.version === version)) || null)
    .catch(() => null);
  const shows = (r) => !!r && want.every((w) => Array.isArray(r.files) && r.files.some((f) => f?.name === w.name && f?.sha256 === w.sha256));

  if (git("status", "--porcelain", "--untracked-files=no").stdout.trim()) log("release: this checkout has changes that are not committed. The installers have them, and the site gets them once they are committed and pushed.");
  const before = await onPage();
  if (shows(before)) return "the site's list has it already.";
  const it = before ? `this upload of ${version}` : version;
  const notYet = before ? `the site's list still has ${version} as it was uploaded before` : "the site's list does not have it yet";
  const ahead = Number(git("rev-list", "--count", "origin/main..HEAD").stdout.trim() || 0);
  if (!ahead) return `${notYet}, and this checkout has nothing to push, so nothing will start a site build. ${BY_HAND}`;
  const branch = git("branch", "--show-current").stdout.trim();
  if (branch !== "main") return `${notYet}. This checkout is on ${branch || "no branch"}, not main: put it on main and push, and the site build that starts lists it.`;
  const push = git("push", "--quiet", "origin", "main");
  if (push.status !== 0) return `the push to main did not succeed, so no site build has started: ${pushProblem(push.stderr)}. Push main once that is fixed, and the build that starts lists it.`;
  log(`release: pushed ${ahead} commit${ahead === 1 ? "" : "s"} to main, which starts the site build. Waiting for the site's list to have ${it}: it takes a few minutes.`);
  for (const end = Date.now() + waitMs; Date.now() < end; ) {
    await new Promise((r) => setTimeout(r, everyMs));
    if (shows(await onPage())) return `the site's list has ${it}, and copies older than 0.1.2 are offered it.`;
  }
  return `the site's list does not have ${it} yet, ${Math.round(waitMs / 60_000)} minutes after the push. Its build is "knitted release" in EZPIPELINE, and its log there says how it went.`;
}
