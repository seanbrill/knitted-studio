// The desktop shell. A walking skeleton: it proves the hard parts work on all
// three operating systems before anything is built on them. Packaging, signing
// and the first-run flow are Phase 12. Updates are update.mjs.
//
//   electron electron/main.mjs                 dev: runs `next dev` and opens it
//   electron electron/main.mjs --prod          runs the built dist/app server
//   electron electron/main.mjs --prod --smoke  load, call /api/health, print, exit
//
// While posts wait to go out, closing the window leaves knitted running in the menu bar or
// tray, so they still go (background.mjs).
//
// The Next server runs as a CHILD process using this same Electron binary as
// plain Node (ELECTRON_RUN_AS_NODE), on a free port bound to 127.0.0.1: chosen at
// random the first time, then the same one each launch while it stays free.
// Any port works, so there is no fixed :4100 assumption anywhere in the code
// (desktop-readiness rule 4), and a crash in it cannot take the window down.

import { app, BrowserWindow, dialog, Menu, nativeImage, net, Notification, session, shell, Tray } from "electron";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBackground } from "./background.mjs";
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
// Running in the background, it opens its window again.
app.on("second-instance", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } else void openWindow?.(); });

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

// What happened at each launch, kept in a file: a desktop app has no console to read, so on
// Windows a server that failed to start left nothing behind but a missing window. The launch
// before stays as knitted.old.log. Opened once this copy knows it is the only one.
let logFile = "", logStream, logged = 0;
function startLog() {
  try {
    app.setAppLogsPath(join(app.getPath("userData"), "logs")); // beside the library, on every system
    logFile = join(app.getPath("logs"), "knitted.log");
    mkdirSync(dirname(logFile), { recursive: true });
    try { renameSync(logFile, logFile.replace(/\.log$/, ".old.log")); } catch { /* the first launch */ }
    logStream = createWriteStream(logFile, { flags: "w" });
    logStream.on("error", () => { logStream = undefined; });
  } catch { /* nowhere to write: run without it */ }
}
/** A line, or the server's own output, into the log, up to 5 MB a launch. */
function log(text) {
  if (!logStream || logged > 5 * 1024 ** 2) return;
  const s = String(text);
  logged += s.length;
  logStream.write(s.endsWith("\n") ? s : `${s}\n`);
  if (logged > 5 * 1024 ** 2) logStream.write("(The log stops here: 5 MB is enough to find what went wrong.)\n");
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
  let tail = "";
  const keep = (d) => { tail = (tail + d).slice(-4000); log(d); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.tail = () => tail;
  return child;
}

/** Waits for the server to answer. A first start on Windows can be slow while it checks every file. */
async function waitFor(url, child, ms = 120_000) {
  const deadline = Date.now() + ms;
  const fail = (say, detail) => Object.assign(new Error(`${detail}\n${child.tail()}`), { say });
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw fail("The part of knitted that does the work stopped as it started.", `server exited (${child.exitCode})`);
    try {
      if ((await fetch(url, { headers: { "x-knitted-token": token } })).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw fail(`The part of knitted that does the work did not answer within ${ms / 1000} seconds.`, `server did not answer at ${url} within ${ms}ms`);
}

// What the window shows while the server starts, so a launch is never only a wait with nothing on screen.
const STARTING = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>knitted</title><style>
html,body{height:100%;margin:0;background:#faf7f2;color:#17110b;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
body{display:grid;place-content:center;justify-items:center;gap:14px;-webkit-user-select:none;user-select:none;cursor:default}
b{font-size:28px;font-weight:800;letter-spacing:-.02em}p{margin:0;color:#6a5d50}
i{display:block;width:120px;height:3px;border-radius:2px;background:#ebdfd2;overflow:hidden}
i::after{content:"";display:block;width:40%;height:100%;border-radius:2px;background:#df5a0f;animation:go 1.2s cubic-bezier(.2,0,0,1) infinite}
@keyframes go{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){i::after{animation:none;width:100%;opacity:.5}}
</style></head><body><b>knitted</b><i></i><p>Starting</p></body></html>`)}`;

let server, background, openWindow;
const quit = (code = 0) => {
  background?.stop();
  server?.kill("SIGKILL");
  updater.finish();
  app.exit(code);
};
const updater = createUpdater({ app, dialog, net, shell, BrowserWindow, Menu }, { quit });

/** The menu bar's icon on a Mac (black, which macOS tints), the app's own elsewhere. */
const trayIcon = () => {
  const mac = process.platform === "darwin";
  const img = nativeImage.createFromPath(join(here, "tray", mac ? "trayTemplate.png" : "tray.png"));
  if (mac) img.setTemplateImage(true);
  return img;
};

app.whenReady().then(async () => {
  let win;
  startLog();
  log(`knitted ${app.getVersion()} on ${process.platform}-${process.arch}, Electron ${process.versions.electron}, started ${new Date().toString()}`);
  try {
    const port = await serverPort();
    const origin = `http://127.0.0.1:${port}`;
    log(`The server: ${serverDir}, on ${origin}. The library: ${process.env.KNITTED_HOME}`);

    const dbg = (...a) => { log(a.join(" ")); if (process.env.KNITTED_DEBUG) console.error("[main]", ...a); };
    const makeWindow = () => {
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
      win.webContents.on("did-fail-load", (_e, code, desc) => dbg("did-fail-load", code, desc));
      return win;
    };
    const load = async (w) => { dbg("loading", origin); await w.loadURL(origin); dbg("loaded"); };
    openWindow = async () => {
      const open = BrowserWindow.getAllWindows()[0];
      if (open) { open.show(); open.focus(); return open; }
      const w = makeWindow();
      background?.shown();
      await load(w);
      return w;
    };

    // The window first, saying it is starting; a second launch meanwhile brings it forward.
    win = makeWindow();
    if (!smoke) void win.loadURL(STARTING);
    server = startServer(port);
    await waitFor(`${origin}/api/health`, server);
    log("The server answered.");

    // The window gets the token as a cookie nothing else on the machine has.
    await session.defaultSession.cookies.set({ url: origin, name: "knitted_token", value: token, httpOnly: true, sameSite: "strict" });
    // Nothing the app does needs a camera, a microphone or a location. A notification says the
    // person's model is done while knitted is behind another window (ModelDone.tsx).
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "clipboard-sanitized-write" || permission === "fullscreen" || permission === "notifications"));
    // Check for Updates goes where each system keeps it: the app menu on a Mac, Help elsewhere.
    const mac = process.platform === "darwin";
    const sep = { type: "separator" };
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(mac ? [{ role: "appMenu", submenu: [{ role: "about" }, sep, ...updater.menu(), sep, { role: "services" }, sep, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, sep, { role: "quit" }] }] : []),
      { role: "fileMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
      { role: "help", submenu: [{ label: "Reveal my library", click: () => shell.openPath(process.env.KNITTED_HOME) }, ...(logFile ? [{ label: "Show the log", click: () => shell.showItemInFolder(logFile) }] : []), { label: "knitted.studio on GitHub", click: () => shell.openExternal("https://github.com/seanbrill/knitted-studio") }, ...(mac ? [] : [sep, ...updater.menu()])] },
    ]));
    await load(win);

    background = createBackground({ app, Tray, Menu, nativeImage, Notification, dialog, BrowserWindow }, { origin, token, openWindow, quit, icon: trayIcon });
    if (!smoke) background.start();

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
    log(`knitted could not start: ${e?.stack ?? e}`);
    // Said, not only logged: a desktop app's console is nowhere a person looks.
    if (!smoke) {
      const { response } = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
        type: "error", title: "knitted", message: "knitted could not start",
        detail: `${e?.say ?? "Something went wrong as it started."}${logStream ? `\n\nWhat happened is in its log, ${logFile}. If it happens again, send that file with your report.` : ""}`,
        buttons: logStream ? ["Open the log", "Quit"] : ["Quit"], defaultId: 0, cancelId: logStream ? 1 : 0, noLink: true,
      }).catch(() => ({ response: 1 }));
      if (logStream && response === 0) await shell.openPath(logFile);
    }
    quit(1);
  }
});

// Closing the last window quits, unless posts are waiting to go out (background.mjs).
app.on("window-all-closed", () => { if (background) void background.allClosed(); else quit(0); });
// The dock icon, clicked while knitted runs without a window.
app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) void openWindow?.(); });
// Quitting with posts waiting asks first; the server stops only once it is really quitting.
app.on("before-quit", (e) => { if (!background?.beforeQuit(e)) server?.kill("SIGKILL"); });
// Quitting from the menu (or Cmd+Q) comes here instead of quit(): an update waiting for it goes in.
app.on("will-quit", () => updater.finish());
