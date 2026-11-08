// Keeping knitted running while posts wait to go out. Posts go out from the studio's
// server, which runs only while the app does, so closing the window used to stop them.
// Now, while posts are waiting (and Settings, Social says to), closing the window leaves
// knitted running, in the menu bar on a Mac and the system tray elsewhere, until the last
// one is out; then it quits, as closing it would have. Quitting with posts waiting asks
// first. A YouTube post already uploaded needs none of this: YouTube publishes it.
//
// Everything Electron is handed in, so this is tested without it (test/background.test.mjs).

const EVERY = 60_000;

/** "2 posts to go out, the next at 9:00 AM", "1 post to go out tomorrow at 9:00 AM". */
export function waitingLine({ waiting, next }, now = Date.now()) {
  if (!waiting) return "No posts waiting";
  const what = waiting === 1 ? "1 post to go out" : `${waiting} posts to go out`;
  const t = next ? Date.parse(next) : NaN;
  if (Number.isNaN(t)) return what;
  if (t <= now) return `${what}, posting now`;
  const d = new Date(t);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date(t).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400_000);
  const when = days === 0 ? `at ${time}` : days === 1 ? `tomorrow at ${time}` : `on ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${time}`;
  return waiting === 1 ? `${what} ${when}` : `${what}, the next ${when}`;
}

/**
 * `e`: { app, Tray, Menu, nativeImage, Notification, dialog }. `openWindow()` makes the window
 * again; `quit(code)` stops the server and exits, as main.mjs does.
 */
export function createBackground(e, { origin, token, openWindow, quit, icon, fetch: f = globalThis.fetch, every = EVERY, now = Date.now }) {
  let state = { waiting: 0, next: null, stayOpen: true };
  let tray = null, timer = null, background = false, told = false, asking = false, sure = false;

  async function look() {
    try {
      const r = await f(`${origin}/api/social/waiting`, { headers: { "x-knitted-token": token } });
      if (r.ok) state = { ...state, ...(await r.json()) };
    } catch {
      // The server is gone: nothing can go out, so there is nothing to wait for.
      state = { ...state, waiting: 0 };
    }
    return state;
  }
  const keep = () => !!state.stayOpen && state.waiting > 0;

  function menu() {
    return e.Menu.buildFromTemplate([
      { label: waitingLine(state, now()), enabled: false },
      { type: "separator" },
      { label: "Open knitted", click: () => openWindow() },
      { label: "Quit knitted", click: () => { sure = true; quit(0); } },
    ]);
  }
  function showTray() {
    if (!tray) {
      tray = new e.Tray(icon());
      tray.on?.("click", () => { if (process.platform !== "darwin") openWindow(); });
    }
    tray.setToolTip(`knitted: ${waitingLine(state, now())}`);
    tray.setContextMenu(menu());
  }
  function hideTray() { tray?.destroy(); tray = null; }

  function goBackground() {
    background = true;
    showTray();
    if (!told && e.Notification?.isSupported?.()) {
      told = true;
      try { new e.Notification({ title: "knitted is still running", body: `${waitingLine(state, now())}. It quits by itself once they are out.`, silent: true }).show(); } catch { /* no notifications here */ }
    }
  }

  async function tick() {
    await look();
    if (!background) return;
    if (!keep()) { hideTray(); return quit(0); }
    showTray();
  }

  return {
    get state() { return state; },
    get background() { return background; },
    /** Look again now, as the minute's timer does. */
    tick,
    start() {
      void look();
      timer = setInterval(() => void tick(), every);
      timer.unref?.();
    },
    stop() { clearInterval(timer); hideTray(); },
    /** The last window closed: keep running while posts are waiting, or quit. */
    async allClosed() {
      await look();
      if (!keep()) return quit(0);
      goBackground();
    },
    /** The window is back (the dock icon, Open knitted): no tray needed. */
    shown() { background = false; hideTray(); },
    /**
     * Quit from the menu or Cmd+Q, with posts waiting: ask first. Called from before-quit,
     * which has to decide at once, so it goes by what the last look found. True: not yet.
     */
    beforeQuit(event) {
      if (sure || !keep()) return false;
      event.preventDefault();
      if (asking) return true;
      asking = true;
      void (async () => {
        const { response } = await e.dialog.showMessageBox({
          type: "question",
          message: `${waitingLine(state, now())}. Quit anyway?`,
          detail: "Posts go out only while knitted is running. One due while it is closed goes out when you open it again, if that is within two hours; after that it waits for you as missed.",
          buttons: ["Keep Running", "Quit"], defaultId: 0, cancelId: 0,
        });
        asking = false;
        if (response === 1) { sure = true; quit(0); }
        else { for (const w of e.BrowserWindow?.getAllWindows?.() ?? []) w.close(); }
      })();
      return true;
    },
  };
}
