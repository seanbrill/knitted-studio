// What the desktop app updates to. The download and the swap need a packed app (see
// docs/RELEASING.md for the check by hand); what to offer, and that it can be checked, is here.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildReleases } from "../apps/site/scripts/releases-lib.mjs";
import { checkable, fileFor, newer, pickUpdate, untranslocated } from "../apps/studio/electron/update.mjs";

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

test("the site publishes the release list the app reads", () => {
  const route = readFileSync("apps/site/app/releases.json/route.ts", "utf8");
  assert.match(route, /force-static/);
  assert.match(readFileSync("apps/studio/electron/update.mjs", "utf8"), /\$\{SITE\}\/releases\.json/);
});
