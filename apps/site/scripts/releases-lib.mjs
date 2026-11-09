// Turn a FileFreak folder listing into the site's releases list.
//
// The release folder holds one folder per version, named v<semver>, with the
// installers inside. Anything else in it is ignored, so a stray file cannot
// become a download button.

const PLATFORMS = [
  [/\.dmg$|\.zip$/i, "macOS"], [/\.exe$|\.msi$/i, "Windows"], [/\.appimage$|\.deb$|\.rpm$/i, "Linux"],
];
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
const systemOf = (name) => (name.toLowerCase().endsWith(".zip") && /linux/i.test(name) ? "Linux" : name.toLowerCase().endsWith(".zip") && /win/i.test(name) ? "Windows" : PLATFORMS.find(([re]) => re.test(name))?.[1] ?? null);
// The chip, from the arch in the name (knitted-0.1.0-mac-arm64.dmg is for Apple silicon).
// None in the name (a universal Mac build) means every chip.
const ARCHS = [[/[-_.](arm64|aarch64)[-_.]/i, "arm64"], [/[-_.](x64|x86_64|amd64)[-_.]/i, "x64"]];
const archOf = (name) => ARCHS.find(([re]) => re.test(name))?.[1] ?? null;
// What each system calls each chip. Windows on x64 gets no word: that is nearly every
// Windows PC, and Windows on Arm runs it.
const CHIPS = { arm64: { macOS: "Apple silicon", Windows: "Arm", Linux: "ARM64" }, x64: { macOS: "Intel", Windows: null, Linux: "x64" } };

export const size = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`);
/** For sort(): the newer of two versions first. */
export const newestFirst = (a, b) => { const p = (v) => v.replace(/^v/, "").split("-")[0].split(".").map(Number); const [x, y] = [p(a), p(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };

/** @param items every item in the folder, files and folders, as the FileFreak tree gives them */
export function buildReleases(items) {
  // Only the version folders nearest the top count. A v1.2.3 folder that ended up
  // inside another folder (a release uploaded one level too deep) would otherwise
  // be listed as a second copy of that version.
  const byId = new Map(items.map((i) => [i.id, i]));
  const depth = (i) => { let d = 0; for (let x = byId.get(i.parentId); x; x = byId.get(x.parentId)) d++; return d; };
  const versionFolders = items.filter((i) => i.kind === "folder" && VERSION.test(i.name));
  const top = Math.min(...versionFolders.map(depth));
  const folders = new Map(versionFolders.filter((i) => depth(i) === top).map((i) => [i.id, i]));
  const skipped = [];
  const byVersion = new Map();
  for (const f of items) {
    if (f.kind !== "file" || !folders.has(f.parentId)) continue;
    const system = systemOf(f.name);
    if (!system) continue;                                     // checksums, blockmaps and the like
    if (!f.publicUrl) { skipped.push(f.name); continue; }       // a download button that cannot work is worse than none
    const version = folders.get(f.parentId).name.replace(/^v/, "");
    const arch = archOf(f.name);
    const chip = arch && CHIPS[arch][system];
    // system and arch are for the button that picks the visitor's file (lib/downloads.ts).
    (byVersion.get(version) ?? byVersion.set(version, []).get(version)).push({
      platform: chip ? `${system} (${chip})` : system, system, arch, name: f.name, url: f.publicUrl, size: size(f.sizeBytes), sha256: f.clientSha256 ?? "not recorded",
    });
  }
  const releases = [...byVersion].sort(([a], [b]) => newestFirst(a, b)).map(([version, files]) => ({ version, files: files.sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name)) }));
  return { releases, skipped };
}
