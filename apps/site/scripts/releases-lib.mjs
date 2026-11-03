// Turn a FileFreak folder listing into the site's releases list.
//
// The release folder holds one folder per version, named v<semver>, with the
// installers inside. Anything else in it is ignored, so a stray file cannot
// become a download button.

const PLATFORMS = [
  [/\.dmg$|\.zip$/i, "macOS"], [/\.exe$|\.msi$/i, "Windows"], [/\.appimage$|\.deb$|\.rpm$/i, "Linux"],
];
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
const platformOf = (name) => (name.toLowerCase().endsWith(".zip") && /linux/i.test(name) ? "Linux" : name.toLowerCase().endsWith(".zip") && /win/i.test(name) ? "Windows" : PLATFORMS.find(([re]) => re.test(name))?.[1] ?? null);

export const size = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`);
const cmp = (a, b) => { const p = (v) => v.replace(/^v/, "").split("-")[0].split(".").map(Number); const [x, y] = [p(a), p(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };

/** @param items every item in the folder, files and folders, as the FileFreak tree gives them */
export function buildReleases(items) {
  const folders = new Map(items.filter((i) => i.kind === "folder" && VERSION.test(i.name)).map((i) => [i.id, i]));
  const skipped = [];
  const byVersion = new Map();
  for (const f of items) {
    if (f.kind !== "file" || !folders.has(f.parentId)) continue;
    const platform = platformOf(f.name);
    if (!platform) continue;                                   // checksums, blockmaps and the like
    if (!f.publicUrl) { skipped.push(f.name); continue; }       // a download button that cannot work is worse than none
    const version = folders.get(f.parentId).name.replace(/^v/, "");
    (byVersion.get(version) ?? byVersion.set(version, []).get(version)).push({
      platform, name: f.name, url: f.publicUrl, size: size(f.sizeBytes), sha256: f.clientSha256 ?? "not recorded",
    });
  }
  const releases = [...byVersion].sort(([a], [b]) => cmp(a, b)).map(([version, files]) => ({ version, files: files.sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name)) }));
  return { releases, skipped };
}
