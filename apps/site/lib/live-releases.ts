// The release list as the release folder has it now, read in the visitor's browser. The page
// is built with the list as it was then (scripts/fetch-releases.mjs), and shows that first;
// this brings it up to date, so a version or a .dmg that went up since is there without a
// site build. The folder is public: FileFreak answers anyone, with no key, and lets any page
// read the answer. The desktop app reads the same folder to update itself
// (apps/studio/electron/update.mjs), and checks a download against SHA256SUMS.txt there.

import { buildReleases, newestFirst } from "../scripts/releases-lib.mjs";
import type { Release } from "./downloads";

/** Where FileFreak answers for public files, and the release folder: one v<version> folder in it per release. */
export const FILES = "https://filefreak.link";
export const FOLDER = "5bb0d646-3b13-46ea-9e6f-d9963887d32c";
/** How many of the newest versions the page knows are read again: a Mac adds its .dmg after the pipeline's upload. */
const RECHECK = 2;

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Item { id: string; parentId: string | null; kind: string; name: string; sizeBytes?: number; publicUrl?: string | null; clientSha256?: string | null; childCount?: number }
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Everything directly in a public folder, every page of its listing. */
async function listing(fetch: Fetch, id: string): Promise<Item[]> {
  const items: Item[] = [];
  for (let offset: number | null = 0; offset !== null;) {
    const res = await fetch(`${FILES}/api/public/files/${id}/items?offset=${offset}&limit=200`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`FileFreak answered ${res.status} for the release folder.`);
    const page = (await res.json()) as { items?: unknown; nextOffset?: unknown };
    const next = page?.nextOffset;
    if (!Array.isArray(page?.items) || !(next === null || (typeof next === "number" && next > offset))) throw new Error("FileFreak's answer is not the release folder's listing.");
    items.push(...(page.items as Item[]).filter((i) => i && UUID.test(String(i.id)) && typeof i.name === "string"));
    offset = next as number | null;
  }
  return items;
}

/**
 * The releases, newest first, as the folder has them now. `known` is the list the page was
 * built with: only the versions it lacks, and its newest few, are opened, so a visit costs
 * one or two small requests. A version is listed once its SHA256SUMS.txt is up, which
 * scripts/publish-release.mjs sends last, so a version still going up is not offered.
 */
export async function liveReleases(fetch: Fetch, known: Release[], folder = FOLDER): Promise<Release[]> {
  const versions = (await listing(fetch, folder)).filter((i) => i.kind === "folder" && VERSION.test(i.name));
  // A folder with no versions in it is not one the page should believe over its own list.
  if (!versions.length) throw new Error("The release folder lists no versions.");
  const had = new Map(known.map((r) => [r.version, r]));
  const recheck = new Set(known.slice(0, RECHECK).map((r) => r.version));
  const versionOf = (i: Item) => i.name.replace(/^v/, "");
  // An empty folder (0.1.19's, whose upload failed) has nothing to read.
  const open = versions.filter((v) => v.childCount !== 0 && (!had.has(versionOf(v)) || recheck.has(versionOf(v))));
  const opened = await Promise.all(open.map(async (v) => ({ v, items: await listing(fetch, v.id) })));
  const fresh = new Map<string, Release>();
  for (const { v, items } of opened) {
    if (!items.some((i) => i.kind === "file" && i.name === "SHA256SUMS.txt")) continue;
    // The same list the site's build makes of it: the same names, chips and sizes.
    const r = buildReleases([{ ...v, parentId: null }, ...items.map((i) => ({ ...i, parentId: v.id }))]).releases[0] as Release | undefined;
    if (r) fresh.set(r.version, r);
  }
  // A version taken out of the folder goes from the page too: its buttons would not work.
  return [...new Set(versions.map(versionOf))].map((v) => fresh.get(v) ?? had.get(v)).filter((r): r is Release => !!r)
    .sort((a, b) => newestFirst(a.version, b.version));
}
