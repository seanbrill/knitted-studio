// What a published version must hold: a file for every system an installed app updates on,
// with the SHA-256 it was built with. Read the way the apps read the release folder
// (apps/studio/electron/update.mjs): FileFreak's public answers, no key. Used by both
// releases, npm run release on a Mac (release.mjs) and the pipeline's (pipeline-release.mjs).

import { fileFor, releaseIn, versionsIn } from "../apps/studio/electron/update.mjs";
import { buildReleases } from "../apps/site/scripts/releases-lib.mjs";

/** Every system and chip an installed copy updates itself on, as Node names them. */
export const SYSTEMS = [["darwin", "arm64"], ["darwin", "x64"], ["win32", "x64"], ["linux", "x64"], ["linux", "arm64"]];

/** The systems a set of installers leaves with no file to update with, as "darwin x64" and the like. */
export function unserved(names) {
  const folder = { id: "v", kind: "folder", name: "v0.0.0", parentId: null };
  const files = names.map((name, i) => ({ id: String(i), kind: "file", name, parentId: "v", sizeBytes: 0, publicUrl: name }));
  const [release] = buildReleases([folder, ...files]).releases;
  return SYSTEMS.filter(([platform, arch]) => !fileFor(release, platform, arch)).map((s) => s.join(" "));
}

/** v<version> in the release folder as the apps see it ({ finished, files }), or null when there is none. */
export async function published(version, fetch = globalThis.fetch) {
  const folder = (await versionsIn(fetch)).find((v) => v.version === version);
  return folder ? releaseIn(fetch, folder) : null;
}

/** What is wrong with v<version> in the folder once it is uploaded, or null. built: the SHA256SUMS.txt that went up. */
export async function problem(version, built, fetch = globalThis.fetch) {
  let release;
  try {
    release = await published(version, fetch);
  } catch (e) {
    return `the release folder could not be read the way the apps read it: ${e.message}`;
  }
  if (!release) return `the release folder shows no v${version}. Make it public in FileFreak, so the apps and the site can see it.`;
  if (!release.finished) return `v${version} has no SHA256SUMS.txt in the release folder, so the apps take it for a release still going up.`;
  for (const [platform, arch] of SYSTEMS) {
    const file = fileFor(release, platform, arch);
    if (!file) return `v${version} has no file the ${platform} ${arch} app can update itself with.`;
    if (!built.includes(`${file.sha256}  ${file.name}`)) return `the release folder's SHA-256 for ${file.name} is not the one built here.`;
  }
  return null;
}
