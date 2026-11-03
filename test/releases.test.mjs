import assert from "node:assert/strict";
import test from "node:test";
import { buildReleases } from "../apps/site/scripts/releases-lib.mjs";

const dir = (id, name) => ({ id, kind: "folder", name, parentId: null });
const file = (id, parentId, name, extra = {}) => ({ id, kind: "file", name, parentId, sizeBytes: 150 * 1024 ** 2, publicUrl: `https://files.example/${id}`, clientSha256: "ab".repeat(32), ...extra });

test("versions are newest first, files are labelled by platform, and the address is the public one", () => {
  const { releases } = buildReleases([
    dir("a", "v0.1.0"), dir("b", "v0.10.0"), dir("c", "v0.2.0"),
    file("1", "a", "knitted-0.1.0-mac-arm64.dmg"), file("2", "b", "knitted-0.10.0-linux-x64.AppImage"), file("3", "b", "knitted-0.10.0-win-x64.exe"),
  ]);
  assert.deepEqual(releases.map((r) => r.version), ["0.10.0", "0.1.0"], "0.10.0 sorts above 0.2.0 and 0.1.0, not as text");
  assert.deepEqual(releases[0].files.map((f) => f.platform), ["Linux", "Windows"]);
  assert.equal(releases[1].files[0].url, "https://files.example/1");
  assert.equal(releases[1].files[0].size, "150 MB");
});

test("checksums, blockmaps, stray folders and loose files never become buttons", () => {
  const { releases } = buildReleases([dir("a", "v1.0.0"), dir("x", "drafts"), file("1", "a", "SHA256SUMS.txt"), file("2", "a", "x.blockmap"), file("3", "x", "knitted.dmg"), file("4", null, "knitted.dmg")]);
  assert.deepEqual(releases, []);
});

test("a file that is not public is left out and reported, because its button could not work", () => {
  const { releases, skipped } = buildReleases([dir("a", "v1.0.0"), file("1", "a", "k.dmg", { publicUrl: null })]);
  assert.deepEqual(releases, []); assert.deepEqual(skipped, ["k.dmg"]);
});

test("a file with no recorded checksum says so instead of inventing one", () => {
  const { releases } = buildReleases([dir("a", "v1.0.0"), file("1", "a", "k.dmg", { clientSha256: null })]);
  assert.equal(releases[0].files[0].sha256, "not recorded");
});
