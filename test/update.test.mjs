// What the desktop app updates to. The download and the swap need a packed app (see
// docs/RELEASING.md for the check by hand); what to offer, and that it can be checked, is here.

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReleases } from "../apps/site/scripts/releases-lib.mjs";
import { RELEASES, SITE, checkable, createUpdater, fileFor, latest, newer, pickUpdate, releaseIn, untranslocated, versionsIn } from "../apps/studio/electron/update.mjs";

const SHA = "a".repeat(64);
// The release list as the site builds it, from files named the way electron-builder names them.
const folder = (version, names) => [
  { id: version, kind: "folder", name: `v${version}`, parentId: null },
  ...names.map((n) => ({ id: `${version}/${n}`, kind: "file", name: n, parentId: version, publicUrl: `https://files.example/${n}`, sizeBytes: 1e8, clientSha256: SHA })),
];
const ALL = (v) => [`knitted-${v}-mac-arm64.dmg`, `knitted-${v}-mac-arm64.zip`, `knitted-${v}-mac-x64.dmg`, `knitted-${v}-mac-x64.zip`, `knitted-${v}-win-x64.exe`, `knitted-${v}-linux-x86_64.AppImage`, `knitted-${v}-linux-arm64.AppImage`];
const { releases } = buildReleases([...folder("0.1.0", ALL("0.1.0")), ...folder("0.1.1", ALL("0.1.1"))]);

test("versions compare as numbers, and a finished version beats its test versions", () => {
  assert.ok(newer("0.1.0", "0.1.1"));
  assert.ok(newer("0.1.9", "0.1.10"), "10 is more than 9, though it sorts before it as text");
  assert.ok(newer("0.9.0", "1.0.0"));
  assert.ok(!newer("0.1.1", "0.1.1"));
  assert.ok(!newer("0.1.1", "0.1.0"));
  assert.ok(newer("0.2.0-beta.1", "0.2.0"));
  assert.ok(newer("0.2.0-beta.2", "0.2.0-beta.10"));
  assert.ok(!newer("0.2.0", "0.2.0-beta.1"));
  assert.ok(newer("v0.1.0", "0.1.1"), "a v in front changes nothing");
  assert.ok(!newer("0.1.0", "not a version"), "nonsense is never an update");
});

test("each system gets the file it can install by itself", () => {
  const r = releases[0];
  assert.equal(fileFor(r, "darwin", "arm64").name, "knitted-0.1.1-mac-arm64.zip", "a Mac swaps in the .zip's app, not the disk image");
  assert.equal(fileFor(r, "darwin", "x64").name, "knitted-0.1.1-mac-x64.zip");
  assert.equal(fileFor(r, "win32", "x64").name, "knitted-0.1.1-win-x64.exe");
  assert.equal(fileFor(r, "win32", "arm64").name, "knitted-0.1.1-win-x64.exe", "Windows on Arm runs the x64 app");
  assert.equal(fileFor(r, "linux", "x64").name, "knitted-0.1.1-linux-x86_64.AppImage");
  assert.equal(fileFor(r, "linux", "arm64").name, "knitted-0.1.1-linux-arm64.AppImage");
  assert.equal(fileFor(r, "freebsd", "x64"), null);
  const dmgOnly = buildReleases(folder("0.1.2", ["knitted-0.1.2-mac-arm64.dmg"])).releases[0];
  assert.equal(fileFor(dmgOnly, "darwin", "arm64"), null, "a disk image is for a person to open");
  const universal = buildReleases(folder("0.1.2", ["knitted-0.1.2-mac.zip"])).releases[0];
  assert.equal(fileFor(universal, "darwin", "arm64").name, "knitted-0.1.2-mac.zip", "no chip in the name is every chip");
});

test("the newest newer release with a file for this computer is offered", () => {
  assert.equal(pickUpdate(releases, "0.1.0", "darwin", "arm64").version, "0.1.1");
  assert.equal(pickUpdate(releases, "0.1.1", "darwin", "arm64"), null, "the newest is up to date");
  assert.equal(pickUpdate(releases, "0.2.0", "darwin", "arm64"), null, "a copy newer than every release is not moved back");
  assert.equal(pickUpdate([...releases].reverse(), "0.1.0", "win32", "x64").version, "0.1.1", "the list's order does not matter");
  // 0.1.2 is out for the Mac only: Windows still gets 0.1.1.
  const more = buildReleases([...folder("0.1.0", ALL("0.1.0")), ...folder("0.1.1", ALL("0.1.1")), ...folder("0.1.2", ["knitted-0.1.2-mac-arm64.zip"])]).releases;
  assert.equal(pickUpdate(more, "0.1.0", "darwin", "arm64").version, "0.1.2");
  assert.equal(pickUpdate(more, "0.1.0", "win32", "x64").version, "0.1.1");
  assert.equal(pickUpdate(undefined, "0.1.0", "darwin", "arm64"), null, "a list that is not there is no update");
});

test("test versions go only to copies that are test versions", () => {
  const beta = buildReleases([...folder("0.1.1", ALL("0.1.1")), ...folder("0.2.0-beta.1", ALL("0.2.0-beta.1"))]).releases;
  assert.equal(pickUpdate(beta, "0.1.0", "darwin", "arm64").version, "0.1.1");
  assert.equal(pickUpdate(beta, "0.2.0-beta.0", "darwin", "arm64").version, "0.2.0-beta.1");
});

test("only a file with a recorded SHA-256 can be checked, so only that one installs by itself", () => {
  assert.ok(checkable(releases[0].files[0]));
  assert.ok(!checkable({ sha256: "not recorded" }), "what the site writes when FileFreak has none");
  assert.ok(!checkable({}));
  assert.ok(!checkable({ sha256: "a".repeat(63) }));
});

test("a Mac copy that macOS runs from a read-only place is traced back to the app it came from", () => {
  // As /sbin/mount prints it when a downloaded app is opened where it was downloaded.
  const tmp = "/private/var/folders/9r/0zm/T/AppTranslocation/2C99DEBC-5FBF-40D0-8582-C411A9EADAA7";
  const mounts = (real) => `/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)\n${real} on ${tmp} (nullfs, local, nodev, nosuid, read-only, nobrowse, mounted by me)\n`;
  assert.equal(untranslocated(`${tmp}/d/knitted.app`, mounts("/Users/me/Downloads/knitted.app")), "/Users/me/Downloads/knitted.app");
  assert.equal(untranslocated(`${tmp}/d/knitted.app`, mounts("/Users/me/My Apps/knitted.app")), "/Users/me/My Apps/knitted.app", "a space in the path");
  assert.equal(untranslocated("/Applications/knitted.app", ""), "/Applications/knitted.app", "an app run where it is stays put");
  assert.equal(untranslocated(`${tmp}/d/knitted.app`, "/dev/disk3s1s1 on / (apfs)"), null, "no mount, no guess");
});

test("every file the desktop shell imports is packed into the app", () => {
  // electron-builder packs only the files listed. One left out, and the app does not start.
  const main = readFileSync("apps/studio/electron/main.mjs", "utf8");
  const packed = readFileSync("apps/studio/electron-builder.yml", "utf8");
  const local = [...main.matchAll(/from "\.\/([\w.-]+)"/g)].map((m) => m[1]);
  assert.ok(local.includes("update.mjs"));
  for (const f of local) assert.match(packed, new RegExp(`^\\s+- electron/${f.replace(".", "\\.")}$`, "m"), `${f} is not in electron-builder.yml's files`);
});

test("the website still publishes the list, for copies before 0.1.2 and for when the folder cannot be read", () => {
  const route = readFileSync("apps/site/app/releases.json/route.ts", "utf8");
  assert.match(route, /force-static/);
  assert.match(readFileSync("apps/studio/electron/update.mjs", "utf8"), /\$\{SITE\}\/releases\.json/);
});

// FileFreak's public answers for the release folder, as https://filefreak.link gives them,
// and every address asked for.
const hash = (name) => createHash("sha256").update(name).digest("hex");
let ids = 0;
const uid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
function fileFreak(versions, { page = 200, goingUp = [], unlisted = [] } = {}) {
  const lists = new Map([[RELEASES, []]]), raws = new Map(), asked = [];
  for (const [version, names] of Object.entries(versions)) {
    const folder = { id: uid(), kind: "folder", name: `v${version}`, parentId: RELEASES };
    const files = names.map((name) => ({ id: uid(), kind: "file", name, parentId: folder.id, sizeBytes: 1e8 }));
    if (!goingUp.includes(version)) {
      files.push({ id: uid(), kind: "file", name: "SHA256SUMS.txt", parentId: folder.id, sizeBytes: 600 });
      raws.set(files.at(-1).id, names.filter((n) => !unlisted.includes(n)).map((n) => `${hash(n)}  ${n}`).join("\n") + "\n");
    }
    lists.get(RELEASES).push(folder);
    lists.set(folder.id, files);
  }
  lists.get(RELEASES).push({ id: uid(), kind: "file", name: "README.txt", parentId: RELEASES, sizeBytes: 10 });
  const fetch = async (url) => {
    asked.push(url);
    const u = new URL(url);
    const [, id, what] = /^\/api\/public\/files\/([^/]+)\/(items|raw)$/.exec(u.pathname) ?? [];
    if (u.origin === "https://filefreak.link" && what === "items" && lists.has(id)) {
      const offset = Number(u.searchParams.get("offset")), all = lists.get(id);
      return Response.json({ items: all.slice(offset, offset + page), nextOffset: offset + page < all.length ? offset + page : null });
    }
    if (u.origin === "https://filefreak.link" && what === "raw" && raws.has(id)) return new Response(raws.get(id));
    return Response.json({ error: "not_found" }, { status: 404 });
  };
  return { fetch, asked };
}

test("the app reads the release folder itself, so a version is offered as soon as its files are up", async () => {
  const ff = fileFreak({ "0.1.0": ALL("0.1.0"), "0.1.1": ALL("0.1.1") });
  const found = await latest(ff.fetch, "0.1.0", "darwin", "arm64");
  assert.equal(found.version, "0.1.1");
  assert.equal(found.file.name, "knitted-0.1.1-mac-arm64.zip");
  assert.match(found.file.url, /^https:\/\/filefreak\.link\/api\/public\/files\/[0-9a-f-]{36}\/raw$/, "the file's public address, with no key");
  assert.equal(found.file.sha256, hash("knitted-0.1.1-mac-arm64.zip"), "the SHA-256 the version's SHA256SUMS.txt records for it");
  assert.ok(checkable(found.file));
  assert.equal((await latest(ff.fetch, "0.1.0", "win32", "arm64")).file.name, "knitted-0.1.1-win-x64.exe");
});

test("an up-to-date copy asks for one listing, and only the versions it may get are opened", async () => {
  const ff = fileFreak({ "0.1.0": ALL("0.1.0"), "0.1.1": ALL("0.1.1"), "0.2.0-beta.1": ALL("0.2.0-beta.1") });
  assert.equal(await latest(ff.fetch, "0.1.1", "darwin", "arm64"), null);
  assert.equal(ff.asked.length, 1, "the release folder's listing, and nothing else");
  ff.asked.length = 0;
  await latest(ff.fetch, "0.1.0", "darwin", "arm64");
  assert.equal(ff.asked.length, 3, "the listing, then 0.1.1's listing and its SHA256SUMS.txt: not 0.1.0's, not the test version's");
});

test("a newer version with nothing for this computer is passed over for one that has", async () => {
  const ff = fileFreak({ "0.1.1": ALL("0.1.1"), "0.1.2": ["knitted-0.1.2-mac-arm64.zip"] });
  assert.equal((await latest(ff.fetch, "0.1.0", "darwin", "arm64")).version, "0.1.2");
  assert.equal((await latest(ff.fetch, "0.1.0", "linux", "x64")).version, "0.1.1");
});

test("a listing in pages is read to its end", async () => {
  const ff = fileFreak(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`0.1.${i}`, ALL(`0.1.${i}`)])), { page: 3 });
  assert.equal((await latest(ff.fetch, "0.1.0", "darwin", "arm64")).version, "0.1.6");
});

test("a version still going up, with no SHA256SUMS.txt yet, is not offered", async () => {
  // The folder is made before the build, and its SHA256SUMS.txt is sent after every installer.
  const ff = fileFreak({ "0.1.1": ALL("0.1.1"), "0.1.2": ALL("0.1.2").slice(0, 3) }, { goingUp: ["0.1.2"] });
  assert.equal((await latest(ff.fetch, "0.1.0", "darwin", "arm64")).version, "0.1.1");
  assert.equal(await latest(ff.fetch, "0.1.1", "darwin", "arm64"), null);
});

test("a file SHA256SUMS.txt does not list is offered, but does not install itself", async () => {
  const ff = fileFreak({ "0.1.1": ALL("0.1.1") }, { unlisted: ["knitted-0.1.1-mac-arm64.zip"] });
  const found = await latest(ff.fetch, "0.1.0", "darwin", "arm64");
  assert.equal(found.version, "0.1.1");
  assert.ok(!checkable(found.file));
  assert.ok(checkable((await latest(ff.fetch, "0.1.0", "darwin", "x64")).file), "the files it does list still install");
});

test("an answer that is not the folder's listing is refused, not taken for no update", async () => {
  await assert.rejects(latest(async () => Response.json({ error: "not_found" }, { status: 404 }), "0.1.0", "darwin", "arm64"), /404/);
  await assert.rejects(latest(async () => Response.json({ hello: "world" }), "0.1.0", "darwin", "arm64"), /not the release folder's listing/);
  await assert.rejects(latest(async () => Response.json({ items: [], nextOffset: 0 }), "0.1.0", "darwin", "arm64"), /not the release folder's listing/, "a listing that never ends");
});

test("the app and the site read an installer's name the same way", async () => {
  const names = [...ALL("0.1.1"), "knitted-0.1.1-mac.zip", "knitted-0.1.1-linux-arm64.zip", "knitted-0.1.1-win-arm64.zip", "knitted-0.1.1-win-x64.msi", "knitted-0.1.1-linux-amd64.deb", "knitted-0.1.1-linux-aarch64.rpm", "knitted-0.1.1-mac-arm64.dmg.blockmap", "notes.txt"];
  const ff = fileFreak({ "0.1.1": names });
  const read = (files) => files.map(({ system, arch, name }) => ({ system, arch, name })).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(read((await releaseIn(ff.fetch, (await versionsIn(ff.fetch))[0])).files), read(buildReleases(folder("0.1.1", names)).releases[0].files));
});

test("Check for Updates reads the release folder, and the website's list only when the folder cannot be read", async (t) => {
  const shown = [];
  const userData = mkdtempSync(join(tmpdir(), "knitted-update-"));
  const check = (fetch, opts = {}) => createUpdater({
    app: { getPath: () => userData, getVersion: () => "0.1.0", isPackaged: false },
    dialog: { showMessageBox: async (o) => { shown.push(o.message); return { response: 1 }; } },
    net: { fetch },
    shell: { openExternal: () => {} },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { getApplicationMenu: () => null },
  }, { quit: () => {}, ...opts }).menu()[0].click();
  const errors = t.mock.method(console, "error", () => {});
  const list = Response.json({ releases });
  const site = async (url) => (url === `${SITE}/releases.json` ? list.clone() : Response.json({ error: "not_found" }, { status: 404 }));

  const ff = fileFreak({ "0.1.1": ALL("0.1.1") });
  await check(ff.fetch);
  assert.equal(shown.pop(), "knitted 0.1.1 is out.");
  assert.ok(ff.asked.every((u) => u.startsWith("https://filefreak.link/")), "the website is not asked when the folder answers");

  await check(site);
  assert.equal(shown.pop(), "knitted 0.1.1 is out.", "the folder cannot be read, and the website's list says what is out");
  assert.match(String(errors.mock.calls.at(-1).arguments), /release folder/);

  await check(async () => Response.json({ error: "down" }, { status: 503 }));
  assert.equal(shown.pop(), "knitted could not check for updates.");

  const stand = [];
  await check(async (url) => { stand.push(url); return list.clone(); }, { feed: "http://127.0.0.1:9/releases.json" });
  assert.deepEqual(stand, ["http://127.0.0.1:9/releases.json"], "a stand-in list, for trying an update by hand, is the only one asked");
  assert.equal(shown.pop(), "knitted 0.1.1 is out.");
});
