// Updates. The app asks the knitted website for its list of releases (the one the
// Download page shows, at /releases.json), and when there is a newer version it downloads
// that version's file for this computer, checks it against the SHA-256 in the list, puts
// it in place and restarts.
//
// Not electron-updater: on a Mac it needs a paid Apple certificate (Squirrel.Mac refuses
// an ad-hoc signed app), and the release list already says everything it would need.
// Electron is passed in, so test/update.test.mjs can load this file in plain Node.
//
// Checking is the person's choice. The privacy page promises that nothing leaves the
// computer unless they send it, so the app asks once whether to check by itself, the menu
// can change the answer, and Check for Updates always works.
//
//   macOS    the .zip, unzipped in userData, its signature and bundle id checked, then
//            swapped for the knitted.app that is running.
//   Windows  the installer, run silently: it closes this copy, installs and starts the new.
//   Linux    the AppImage, written over the one that is running (process.env.APPIMAGE).
// A copy that cannot replace itself (a Mac copy run from the disk image, a folder it
// cannot write to, a Linux copy that is not an AppImage) sends the person to the Download
// page instead.

import { createHash } from "node:crypto";
import { execFile, execFileSync, spawn } from "node:child_process";
import { accessSync, chmodSync, constants, createWriteStream, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const SITE = "https://knitted.filefreak.page";
const DOWNLOAD_PAGE = `${SITE}/download/`;
const DAY = 24 * 60 * 60 * 1000;

const parse = (v) => {
  const s = String(v).replace(/^v/, "");
  const i = s.indexOf("-");
  return { nums: (i < 0 ? s : s.slice(0, i)).split(".").map(Number), pre: i < 0 ? null : s.slice(i + 1) };
};

/** Is version b newer than version a? 0.2.0 is newer than 0.2.0-beta.1, which is newer than 0.1.9. */
export function newer(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (y.nums[i] || 0) - (x.nums[i] || 0);
    if (d) return d > 0;
  }
  if (x.pre === y.pre) return false;
  if (y.pre === null) return true;
  if (x.pre === null) return false;
  return y.pre.localeCompare(x.pre, "en", { numeric: true }) > 0;
}

/** A release's file for this copy's system and chip, or null. Windows on Arm runs the x64 installer. */
export function fileFor(release, platform, arch) {
  const files = release?.files ?? [];
  const find = (system, ext, chip) => files.find((f) => f.system === system && String(f.name).toLowerCase().endsWith(ext) && (f.arch === chip || f.arch === null));
  if (platform === "darwin") return find("macOS", ".zip", arch) ?? null;
  if (platform === "win32") return find("Windows", ".exe", arch) ?? (arch === "arm64" ? find("Windows", ".exe", "x64") : undefined) ?? null;
  if (platform === "linux") return find("Linux", ".appimage", arch) ?? null;
  return null;
}

/**
 * The newest release newer than `current` with a file for this computer, or null. Test
 * versions (0.2.0-beta.1) are only offered to a copy that is itself a test version.
 */
export function pickUpdate(releases, current, platform, arch) {
  const testing = String(current).includes("-");
  const candidates = (Array.isArray(releases) ? releases : [])
    .filter((r) => r && (testing || !String(r.version).includes("-")) && newer(current, r.version))
    .sort((a, b) => (newer(a.version, b.version) ? 1 : newer(b.version, a.version) ? -1 : 0));
  for (const r of candidates) {
    const file = fileFor(r, platform, arch);
    if (file) return { version: String(r.version), file };
  }
  return null;
}

/** Only a file whose SHA-256 the release list records can be checked, so only that is installed. */
export const checkable = (file) => /^[0-9a-f]{64}$/i.test(String(file?.sha256));

const run = (cmd, args) => new Promise((ok, fail) => execFile(cmd, args, { maxBuffer: 1 << 20 }, (e, out, err) => (e ? fail(new Error(`${basename(cmd)}: ${String(err || e.message).trim()}`)) : ok(String(out)))));
const plist = async (app, key) => (await run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", join(app, "Contents/Info.plist")])).trim();
const writable = (p) => { try { accessSync(p, constants.W_OK); return true; } catch { return false; } };

/**
 * The app macOS is really running. A downloaded app opened where it was downloaded runs
 * from a read-only copy (App Translocation, at .../AppTranslocation/<id>/d/knitted.app);
 * the copy is mounted from the real one, and the mount says where that is.
 */
export function untranslocated(bundle, mounts) {
  const m = /^(.+\/AppTranslocation\/[^/]+)\/d\/[^/]+\.app$/.exec(bundle);
  if (!m) return bundle;
  const on = ` on ${m[1]} (`;
  const line = mounts.split("\n").find((l) => l.includes(on));
  return line ? line.slice(0, line.indexOf(on)) : null;
}

/**
 * @param electron { app, dialog, net, shell, BrowserWindow, Menu }
 * @param quit closes the server and exits, as main.mjs does
 */
export function createUpdater({ app, dialog, net, shell, BrowserWindow, Menu }, { quit, feed = process.env.KNITTED_UPDATE_URL || `${SITE}/releases.json` }) {
  const dir = join(app.getPath("userData"), "update");
  const prefsFile = join(app.getPath("userData"), "updates.json");
  const current = app.getVersion();
  const mac = process.platform === "darwin";
  const menuName = mac ? "the knitted menu" : "the Help menu";
  let busy = false;       // a check or a download is under way
  let ready = null;       // { version, install(relaunch) }, once a download is in place
  let postponed = null;   // the version the person said Not Now to, this launch
  let first = null, timer = null;

  const prefs = () => { try { return JSON.parse(readFileSync(prefsFile, "utf8")); } catch { return {}; } };
  const window = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const ask = async (o) => { const w = window(); return (await (w ? dialog.showMessageBox(w, { noLink: true, ...o }) : dialog.showMessageBox({ noLink: true, ...o }))).response; };
  const offerPage = async (message, detail) => {
    if (await ask({ type: "info", message, detail, buttons: ["Open Download Page", "Close"], defaultId: 0, cancelId: 1 }) === 0) shell.openExternal(DOWNLOAD_PAGE);
  };
  const failed = (message, e) => offerPage(message, `${String(e?.message ?? e)}\n\nYou can download the newest version from the Download page instead.`);

  /** Where this copy lives, if it can replace itself there; otherwise why not. */
  async function here() {
    if (!app.isPackaged) return { why: "This copy runs from the source code. Pull the newest code instead." };
    if (mac) {
      const running = resolve(app.getPath("exe"), "../../..");
      const bundle = untranslocated(running, running.includes("/AppTranslocation/") ? await run("/sbin/mount", []).catch(() => "") : "");
      if (!bundle?.endsWith(".app") || (bundle !== running && await plist(bundle, "CFBundleIdentifier").catch(() => null) !== await plist(running, "CFBundleIdentifier"))) {
        return { why: "knitted cannot find its own app to replace. Move it to your Applications folder and open it from there." };
      }
      if (!writable(dirname(bundle)) || !writable(bundle)) {
        return { why: "Move knitted to your Applications folder and open it from there. It cannot replace a copy that runs from the disk image or from a folder it cannot write to." };
      }
      return { kind: "mac", bundle, exe: join(bundle, "Contents/MacOS", basename(app.getPath("exe"))) };
    }
    if (process.platform === "win32") return { kind: "win" };
    if (process.platform === "linux") {
      const image = process.env.APPIMAGE;
      if (!image) return { why: "This copy was not installed as an AppImage, so it cannot replace itself." };
      if (!writable(dirname(image)) || !writable(image)) return { why: "knitted is in a folder it cannot write to." };
      return { kind: "linux", image, staged: join(dirname(image), `.${basename(image)}.update`) };
    }
    return { why: "knitted cannot update itself on this system." };
  }

  async function download(file, to) {
    const w = window();
    const stop = new AbortController();
    let idle;
    const wait = () => { clearTimeout(idle); idle = setTimeout(() => stop.abort(new Error("The download stopped answering.")), 60_000); };
    wait();
    try {
      const res = await net.fetch(file.url, { signal: stop.signal });
      if (!res.ok || !res.body) throw new Error(`The download answered ${res.status}.`);
      const total = Number(res.headers.get("content-length")) || 0;
      const hash = createHash("sha256");
      let got = 0, shown = -1;
      const count = new Transform({
        transform(chunk, _enc, done) {
          wait();
          hash.update(chunk);
          got += chunk.length;
          const pct = total ? Math.floor((got * 100) / total) : -1;
          if (pct !== shown) { shown = pct; w?.setProgressBar(pct / 100); }
          done(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body), count, createWriteStream(to));
      if (hash.digest("hex") !== String(file.sha256).toLowerCase()) throw new Error("The download is not the file the release lists: its SHA-256 is different.");
    } finally {
      clearTimeout(idle);
      w?.setProgressBar(-1);
    }
  }

  // Each returns what installs it: now (and restart), or when the person quits.
  async function prepare(where, version, file) {
    await mkdir(dir, { recursive: true });
    if (where.kind === "mac") {
      const zip = join(dir, "knitted-next.zip"), out = join(dir, "knitted-next");
      await download(file, zip);
      await rm(out, { recursive: true, force: true });
      await run("/usr/bin/ditto", ["-x", "-k", zip, out]);
      const apps = (await readdir(out)).filter((n) => n.endsWith(".app"));
      if (apps.length !== 1) throw new Error("The download does not hold one app.");
      const staged = join(out, apps[0]);
      await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", staged]);
      if (await plist(staged, "CFBundleIdentifier") !== await plist(where.bundle, "CFBundleIdentifier")) throw new Error("The download is a different app.");
      if (await plist(staged, "CFBundleShortVersionString") !== version) throw new Error(`The download is not version ${version}.`);
      // By its real path: the read-only copy macOS may be running this from goes with the old app.
      return (relaunch) => { swap(where.bundle, staged); if (relaunch) app.relaunch({ execPath: where.exe, args: process.argv.slice(1) }); };
    }
    if (where.kind === "win") {
      const exe = join(dir, "knitted-next.exe");
      await download(file, exe);
      return (relaunch) => spawn(exe, ["--updated", "/S", ...(relaunch ? ["--force-run"] : [])], { detached: true, stdio: "ignore" }).unref();
    }
    await download(file, where.staged);
    chmodSync(where.staged, 0o755);
    return (relaunch) => { renameSync(where.staged, where.image); if (relaunch) app.relaunch({ execPath: where.image, args: process.argv.slice(1) }); };
  }

  // The old app steps aside, the new one takes its name, then the old one goes. If the
  // new one cannot take its place, the old one comes back, so there is always a knitted.
  // An app on another disk than userData is copied across instead of moved.
  function swap(bundle, staged) {
    const old = `${bundle}.old`;
    rmSync(old, { recursive: true, force: true });
    renameSync(bundle, old);
    try {
      try { renameSync(staged, bundle); } catch (e) { if (e.code !== "EXDEV") throw e; execFileSync("/usr/bin/ditto", [staged, bundle]); }
    } catch (e) {
      rmSync(bundle, { recursive: true, force: true });
      renameSync(old, bundle);
      throw e.code === "EPERM" || e.code === "EACCES"
        ? new Error("macOS did not let knitted replace itself. Allow it in System Settings, Privacy & Security, App Management, then try again.")
        : e;
    }
    rmSync(old, { recursive: true, force: true });
  }

  async function offerRestart() {
    const r = await ask({ type: "info", message: "Restart knitted to finish updating?", detail: `knitted ${ready.version} is ready. A knit that is still running will stop.`, buttons: ["Restart Now", "When I Quit"], defaultId: 0, cancelId: 1 });
    if (r !== 0 || !ready) return;
    const { install } = ready;
    ready = null;
    try { install(true); } catch (e) { await failed("knitted could not install the update.", e); return; }
    quit(0);
  }

  /** manual: the person asked, so every outcome gets an answer. Otherwise only news does. */
  async function check({ manual }) {
    if (ready) return manual ? offerRestart() : undefined;
    if (busy) {
      if (manual) await ask({ type: "info", message: "knitted is already getting an update.", detail: "It asks to restart when the update is in place.", buttons: ["OK"] });
      return;
    }
    busy = true;
    try {
      let found;
      try {
        const res = await net.fetch(feed, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`The website answered ${res.status}.`);
        found = pickUpdate((await res.json()).releases, current, process.platform, process.arch);
      } catch (e) {
        if (manual) await failed("knitted could not check for updates.", e);
        else console.error("[update] check:", e?.message ?? e);
        return;
      }
      if (!found) {
        if (manual) await ask({ type: "info", message: "knitted is up to date.", detail: `You have ${current}, the newest version.`, buttons: ["OK"] });
        return;
      }
      // Each version is news once a launch, unless the person asks.
      if (!manual) { if (postponed === found.version) return; postponed = found.version; }
      const where = await here();
      if (where.why) return offerPage(`knitted ${found.version} is out.`, `You have ${current}. ${where.why}`);
      if (!checkable(found.file)) return offerPage(`knitted ${found.version} is out.`, `You have ${current}. The release does not list this file's SHA-256, so knitted cannot check the download, and will not install it by itself.`);
      const r = await ask({ type: "info", message: `knitted ${found.version} is out.`, detail: `You have ${current}. knitted downloads it while you work, then asks to restart.`, buttons: ["Update", "Not Now"], defaultId: 0, cancelId: 1 });
      if (r !== 0) { postponed = found.version; return; }
      try {
        ready = { version: found.version, install: await prepare(where, found.version, found.file) };
      } catch (e) {
        // Nothing half-downloaded or refused is kept.
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        if (where.staged) await rm(where.staged, { force: true }).catch(() => {});
        await failed("knitted could not get the update.", e);
        return;
      }
    } finally {
      busy = false;
    }
    await offerRestart();
  }

  function setAuto(on) {
    try { writeFileSync(prefsFile, JSON.stringify({ ...prefs(), auto: on })); } catch { /* asked again next launch */ }
    const item = Menu.getApplicationMenu()?.getMenuItemById("update-auto");
    if (item) item.checked = on;
    clearTimeout(first);
    clearInterval(timer);
    if (on) {
      first = setTimeout(() => check({ manual: false }), 10_000);
      timer = setInterval(() => check({ manual: false }), DAY);
    }
  }

  return {
    /** The menu items, for the knitted menu on a Mac and the Help menu elsewhere. */
    menu: () => [
      { label: "Check for Updates…", click: () => check({ manual: true }) },
      { id: "update-auto", label: "Check for Updates Automatically", type: "checkbox", checked: prefs().auto === true, click: (item) => setAuto(item.checked) },
    ],

    /** After the window opens: tidy what an earlier update left, then check, or ask once whether to. */
    start() {
      rm(dir, { recursive: true, force: true }).catch(() => {});
      here().then((where) => {
        if (where.kind === "mac") return rm(`${where.bundle}.old`, { recursive: true, force: true });
        if (where.kind === "linux") return rm(where.staged, { force: true });
      }).catch(() => {});
      const auto = prefs().auto;
      if (auto === true) setAuto(true);
      else if (auto === undefined && app.isPackaged) {
        setTimeout(async () => {
          const r = await ask({
            type: "question", message: "Check for updates automatically?",
            detail: `knitted can ask its website once a day whether there is a newer version. It asks for the list of releases, the way a browser asks for a page, and sends nothing about your work. You can change this in ${menuName}.`,
            buttons: ["Check Automatically", "Don't Check"], defaultId: 0, cancelId: 1,
          });
          setAuto(r === 0);
        }, 3000);
      }
    },

    /** On quit: an update the person said to install when they quit goes in now, without a restart. */
    finish() {
      const r = ready;
      ready = null;
      if (r) try { r.install(false); } catch (e) { console.error("[update] install on quit:", e?.message ?? e); }
    },
  };
}
