// The desktop shell. A walking skeleton: it proves the hard parts work on all
// three operating systems before anything is built on them. Packaging, signing
// and the first-run flow are Phase 12. Updates are update.mjs.
//
//   electron electron/main.mjs                 dev: runs `next dev` and opens it
//   electron electron/main.mjs --prod          runs the built dist/app server
//   electron electron/main.mjs --prod --smoke  load, call /api/health, print, exit
//
// The Next server runs as a CHILD process using this same Electron binary as
// plain Node (ELECTRON_RUN_AS_NODE), on a free port bound to 127.0.0.1: chosen at
// random the first time, then the same one each launch while it stays free.
// Any port works, so there is no fixed :4100 assumption anywhere in the code
// (desktop-readiness rule 4), and a crash in it cannot take the window down.

import { app, BrowserWindow, dialog, Menu, net, session, shell } from "electron";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createUpdater } from "./update.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const args = new Set(process.argv.slice(app.isPackaged ? 1 : 2));
const packaged = app.isPackaged;
const prod = packaged || args.has("--prod");
const smoke = args.has("--smoke");

// Name first: userData is derived from it, and an unnamed dev run would put
// the library under ".../Electron/", which a user would never think to look for.
app.setName("knitted-studio");

// The library lives in Electron's per-user data directory unless the caller
// chose somewhere. Set before the server starts so `paths()` sees it
// (desktop-readiness rule 1: one place decides where files go).
process.env.KNITTED_HOME ||= join(app.getPath("userData"), "library");

// One copy at a time: a second launch brings the first to the front.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });

// CI Linux runners have no setuid chrome-sandbox. Opt-in only, never default.
if (process.env.KNITTED_NO_SANDBOX === "1") app.commandLine.appendSwitch("no-sandbox");

/** The port, if it can be listened on now (0: any free one). */
function freePort(want = 0) {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(want, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// The same port as last time, so the MCP address in Settings (which Claude Code and
// other MCP clients keep) still works after a restart. A new one only when another
// program has taken it.
const portFile = join(app.getPath("userData"), "server-port");
async function serverPort() {
  let last = 0;
  try { last = Number(readFileSync(portFile, "utf8")); } catch { /* first launch */ }
  if (Number.isInteger(last) && last > 1024 && last < 65536) {
    try { return await freePort(last); } catch { /* taken */ }
  }
  const port = await freePort();
  try { writeFileSync(portFile, String(port)); } catch { /* next launch picks again */ }
  return port;
}

// Where the server and its tools live: inside the installed app, or in the repo.
const serverDir = packaged ? join(process.resourcesPath, "app-server/apps/studio") : join(repo, "dist/app/apps/studio");
const binDir = packaged ? join(process.resourcesPath, "bin") : join(repo, "build/bin");
const token = randomBytes(32).toString("hex");

function startServer(port) {
  // The bundled ffmpeg goes FIRST on the path: the app never depends on what is installed on the machine.
  const env = {
    ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", ELECTRON_RUN_AS_NODE: "1",
    KNITTED_API_TOKEN: token, KNITTED_DESKTOP: "1",
    PATH: [binDir, process.env.PATH].filter(Boolean).join(delimiter),
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || join(app.getPath("userData"), "browsers"),
  };
  const cmd = prod
    ? [join(serverDir, "server.js")]
    : [join(repo, "node_modules/next/dist/bin/next"), "dev", "-p", String(port), "-H", "127.0.0.1"];
  const child = spawn(process.execPath, cmd, {
    cwd: prod ? serverDir : join(repo, "apps/studio"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const keep = (d) => { log = (log + d).slice(-4000); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.tail = () => log;
  return child;
}

async function waitFor(url, child, ms = 60_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited (${child.exitCode})\n${child.tail()}`);
    try {
      if ((await fetch(url, { headers: { "x-knitted-token": token } })).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not answer at ${url} within ${ms}ms\n${child.tail()}`);
}

let server;
const quit = (code = 0) => {
  server?.kill("SIGKILL");
  updater.finish();
  app.exit(code);
};
const updater = createUpdater({ app, dialog, net, shell, BrowserWindow, Menu }, { quit });

app.whenReady().then(async () => {
  try {
    const port = await serverPort();
    server = startServer(port);
    const origin = `http://127.0.0.1:${port}`;
    await waitFor(`${origin}/api/health`, server);

    // The window gets the token as a cookie nothing else on the machine has.
    await session.defaultSession.cookies.set({ url: origin, name: "knitted_token", value: token, httpOnly: true, sameSite: "strict" });
    // Nothing the app does needs a camera, a microphone, a location or a notification.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "clipboard-sanitized-write" || permission === "fullscreen"));
    // Check for Updates goes where each system keeps it: the app menu on a Mac, Help elsewhere.
    const mac = process.platform === "darwin";
    const sep = { type: "separator" };
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(mac ? [{ role: "appMenu", submenu: [{ role: "about" }, sep, ...updater.menu(), sep, { role: "services" }, sep, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, sep, { role: "quit" }] }] : []),
      { role: "fileMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
      { role: "help", submenu: [{ label: "Reveal my library", click: () => shell.openPath(process.env.KNITTED_HOME) }, { label: "knitted.studio on GitHub", click: () => shell.openExternal("https://github.com/seanbrill/knitted-studio") }, ...(mac ? [] : [sep, ...updater.menu()])] },
    ]));

    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      show: !smoke,
      backgroundColor: "#faf7f2",
      webPreferences: {
        // Non-negotiable hardening, from the first commit rather than the last.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // No second windows, and nothing navigates away from our own origin: links
    // to elsewhere open in the user's browser instead.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (e, url) => {
      if (!url.startsWith(origin)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
    });

    const dbg = (...a) => process.env.KNITTED_DEBUG && console.error("[main]", ...a);
    win.webContents.on("did-fail-load", (_e, code, desc) => dbg("did-fail-load", code, desc));
    dbg("loading", origin);
    await win.loadURL(origin);
    dbg("loaded");

    if (!smoke) updater.start();

    if (smoke) {
      // Ask FROM the page, so this exercises window -> server -> SQLite.
      const health = await win.webContents.executeJavaScript("fetch('/api/health').then(r => r.json())");
      const title = await win.webContents.executeJavaScript("document.title");
      console.log(JSON.stringify({ smoke: "ok", title, health }));
      quit(health.ok && health.electron ? 0 : 1);
    }
  } catch (e) {
    console.error(String(e?.stack ?? e));
    quit(1);
  }
});

app.on("window-all-closed", () => quit(0));
app.on("before-quit", () => server?.kill("SIGKILL"));
// Quitting from the menu (or Cmd+Q) comes here instead of quit(): an update waiting for it goes in.
app.on("will-quit", () => updater.finish());
