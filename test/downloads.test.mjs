// The Download page's one button: which installer it offers, from what the browser says.

import assert from "node:assert/strict";
import test from "node:test";
import { detect, offer, pick } from "../apps/site/lib/downloads.ts";
import { buildReleases } from "../apps/site/scripts/releases-lib.mjs";

// A release's files exactly as the page gets them, from the names npm run release uploads.
const release = (...names) => buildReleases([
  { id: "v", kind: "folder", name: "v1.0.0", parentId: null },
  ...names.map((name, i) => ({ id: String(i), kind: "file", name, parentId: "v", sizeBytes: 1, publicUrl: `https://files.example/${name}`, clientSha256: null })),
]).releases[0].files;
const FILES = release("knitted-1.0.0-mac-arm64.dmg", "knitted-1.0.0-mac-arm64.zip", "knitted-1.0.0-mac-x64.dmg", "knitted-1.0.0-mac-x64.zip",
  "knitted-1.0.0-win-x64.exe", "knitted-1.0.0-linux-arm64.AppImage", "knitted-1.0.0-linux-x86_64.AppImage");

// What each browser sends. Every Mac browser says "Intel Mac OS X", Apple silicon or not.
const UA = {
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0",
  chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  chromeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  firefoxWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
  firefoxLinuxArm: "Mozilla/5.0 (X11; Linux aarch64; rv:144.0) Gecko/20100101 Firefox/144.0",
  chromeLinux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  iPhone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
  chromebook: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
};
const offered = (signals, files = FILES) => {
  const o = offer(files, detect(signals));
  return o.kind === "file" ? [o.file.name, o.intel?.name ?? null] : o.kind;
};

test("a Mac in a Chromium browser gets the disk image for the chip it names", () => {
  assert.deepEqual(offered({ userAgent: UA.chromeMac, platform: "macOS", mobile: false, architecture: "arm" }), ["knitted-1.0.0-mac-arm64.dmg", null]);
  assert.deepEqual(offered({ userAgent: UA.chromeMac, platform: "macOS", mobile: false, architecture: "x86" }), ["knitted-1.0.0-mac-x64.dmg", null]);
});

test("in Safari and Firefox the graphics chip tells the Mac, and a guess also offers the Intel version", () => {
  assert.deepEqual(offered({ userAgent: UA.firefoxMac, gpu: "Apple M2 Pro, or similar" }), ["knitted-1.0.0-mac-arm64.dmg", null]);
  assert.deepEqual(offered({ userAgent: UA.firefoxMac, gpu: "Intel(R) UHD Graphics 630, or similar" }), ["knitted-1.0.0-mac-x64.dmg", null]);
  assert.deepEqual(offered({ userAgent: UA.chromeMac, gpu: "ANGLE (AMD, AMD Radeon Pro 5500M OpenGL Engine, OpenGL 4.1)" }), ["knitted-1.0.0-mac-x64.dmg", null]);
  // Safari names every Mac's graphics "Apple GPU", so that is a guess, and so is no name at all.
  for (const gpu of ["Apple GPU", undefined]) assert.deepEqual(offered({ userAgent: UA.safariMac, gpu }), ["knitted-1.0.0-mac-arm64.dmg", "knitted-1.0.0-mac-x64.dmg"]);
});

test("Windows gets the installer, Windows on Arm too, because it runs x64 apps", () => {
  assert.deepEqual(offered({ userAgent: UA.chromeWindows, platform: "Windows", mobile: false, architecture: "x86" }), ["knitted-1.0.0-win-x64.exe", null]);
  assert.deepEqual(offered({ userAgent: UA.chromeWindows, platform: "Windows", mobile: false, architecture: "arm" }), ["knitted-1.0.0-win-x64.exe", null]);
  assert.deepEqual(offered({ userAgent: UA.firefoxWindows }), ["knitted-1.0.0-win-x64.exe", null]);
});

test("Linux gets the AppImage for its chip, which a Linux user agent still names", () => {
  assert.deepEqual(offered({ userAgent: UA.firefoxLinux }), ["knitted-1.0.0-linux-x86_64.AppImage", null]);
  assert.deepEqual(offered({ userAgent: UA.firefoxLinuxArm }), ["knitted-1.0.0-linux-arm64.AppImage", null]);
  assert.deepEqual(offered({ userAgent: UA.chromeLinux, platform: "Linux", mobile: false, architecture: "arm" }), ["knitted-1.0.0-linux-arm64.AppImage", null]);
});

test("phones and tablets are told it is a desktop app, an iPad asking for the desktop page included", () => {
  assert.equal(offered({ userAgent: UA.iPhone, maxTouchPoints: 5 }), "mobile");
  assert.equal(offered({ userAgent: UA.android, platform: "Android", mobile: true }), "mobile");
  assert.equal(offered({ userAgent: UA.safariMac, maxTouchPoints: 5 }), "mobile");
  assert.deepEqual(offered({ userAgent: UA.safariMac, maxTouchPoints: 0 }), ["knitted-1.0.0-mac-arm64.dmg", "knitted-1.0.0-mac-x64.dmg"]);
});

test("a computer it cannot place, or one nothing in the release runs on, gets the full list instead", () => {
  assert.equal(offered({ userAgent: UA.chromebook, platform: "Chrome OS", mobile: false }), "unknown");
  assert.equal(offered({ userAgent: "" }), "unknown");
  const appleSiliconOnly = release("knitted-1.0.0-mac-arm64.dmg", "knitted-1.0.0-linux-x86_64.AppImage");
  assert.equal(offered({ userAgent: UA.firefoxMac, gpu: "Intel Iris Plus Graphics" }, appleSiliconOnly), "none", "an Intel Mac cannot run an Apple silicon app");
  assert.equal(offered({ userAgent: UA.firefoxLinuxArm }, appleSiliconOnly), "none", "nor an ARM Linux one built for x64");
  assert.equal(offered({ userAgent: UA.firefoxWindows }, appleSiliconOnly), "none");
});

test("a chip runs what it can emulate when its own build is missing", () => {
  const intelOnly = release("knitted-1.0.0-mac-x64.dmg");
  assert.deepEqual(offered({ userAgent: UA.chromeMac, platform: "macOS", architecture: "arm" }, intelOnly), ["knitted-1.0.0-mac-x64.dmg", null], "Apple silicon runs Intel apps");
  assert.deepEqual(offered({ userAgent: UA.safariMac }, intelOnly), ["knitted-1.0.0-mac-x64.dmg", null], "and is not offered the same file twice");
});

test("the file people double-click comes first, and a universal Mac build serves both chips", () => {
  assert.equal(pick(FILES, "macOS", "arm64").name, "knitted-1.0.0-mac-arm64.dmg", "a disk image before a zip");
  const universal = release("knitted-1.0.0-mac-arm64.zip", "knitted-1.0.0-mac-universal.dmg");
  assert.equal(pick(universal, "macOS", "arm64").name, "knitted-1.0.0-mac-universal.dmg");
  assert.equal(pick(universal, "macOS", "x64").name, "knitted-1.0.0-mac-universal.dmg");
  assert.deepEqual(offered({ userAgent: UA.safariMac }, universal), ["knitted-1.0.0-mac-universal.dmg", null]);
  assert.equal(pick(release("knitted-1.0.0-mac-x64.dmg", "knitted-1.0.0-mac-arm64.zip"), "macOS", "arm64").name, "knitted-1.0.0-mac-arm64.zip", "its own chip before an emulated one");
});
