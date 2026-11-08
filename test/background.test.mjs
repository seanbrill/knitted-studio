// The desktop app keeps running without its window while posts wait to go out, and quits
// once they are out. Electron is faked here: what it is asked to do is what is checked.

import assert from "node:assert/strict";
import test from "node:test";
import { createBackground, waitingLine } from "../apps/studio/electron/background.mjs";

const NOW = new Date(2026, 10, 9, 8, 0).getTime();
const iso = (h, m = 0, day = 9) => new Date(2026, 10, day, h, m).toISOString();

function fakes(answers) {
  const log = [];
  let n = 0;
  class Tray {
    constructor() { log.push("tray"); }
    on() {}
    setToolTip(t) { this.tip = t; log.push(`tip: ${t}`); }
    setContextMenu(m) { this.menu = m; }
    destroy() { log.push("tray gone"); }
  }
  const e = {
    Tray, Menu: { buildFromTemplate: (items) => items },
    Notification: class { static isSupported() { return true; } constructor(o) { this.o = o; } show() { log.push(`told: ${this.o.body}`); } },
    dialog: { showMessageBox: async (o) => { log.push(`asked: ${o.message}`); return { response: e.answer ?? 0 }; } },
    BrowserWindow: { getAllWindows: () => [{ close: () => log.push("window closed") }] },
  };
  const fetch = async (url, init) => {
    assert.equal(init.headers["x-knitted-token"], "t", "the server's token goes with every look");
    assert.match(url, /\/api\/social\/waiting$/);
    const a = answers[Math.min(n++, answers.length - 1)];
    if (a instanceof Error) throw a;
    return { ok: true, json: async () => a };
  };
  const bg = createBackground(e, { origin: "http://127.0.0.1:1", token: "t", openWindow: () => log.push("opened"), quit: (c) => log.push(`quit ${c}`), icon: () => ({}), fetch, every: 1e9, now: () => NOW });
  return { bg, log, e };
}

test("the tray says how many posts wait and when the next goes, in words", () => {
  assert.equal(waitingLine({ waiting: 0 }, NOW), "No posts waiting");
  assert.equal(waitingLine({ waiting: 1, next: iso(9) }, NOW), "1 post to go out at 9:00 AM");
  assert.equal(waitingLine({ waiting: 3, next: iso(9, 30) }, NOW), "3 posts to go out, the next at 9:30 AM");
  assert.equal(waitingLine({ waiting: 2, next: iso(9, 0, 10) }, NOW), "2 posts to go out, the next tomorrow at 9:00 AM");
  assert.match(waitingLine({ waiting: 2, next: iso(9, 0, 13) }, NOW), /the next on Fri, Nov 13 at 9:00 AM$/);
  assert.equal(waitingLine({ waiting: 1, next: iso(7) }, NOW), "1 post to go out, posting now");
});

test("closing the window with nothing waiting quits, as before", async () => {
  const { bg, log } = fakes([{ waiting: 0, next: null, stayOpen: true }]);
  await bg.allClosed();
  assert.deepEqual(log, ["quit 0"]);
});

test("closing the window with posts waiting keeps knitted in the tray, says so once, and quits when they are out", async () => {
  const { bg, log } = fakes([{ waiting: 2, next: iso(9), stayOpen: true }, { waiting: 1, next: iso(9, 30), stayOpen: true }, { waiting: 0, next: null, stayOpen: true }]);
  await bg.allClosed();
  assert.ok(bg.background);
  assert.ok(log.includes("tray"));
  assert.ok(log.includes("tip: knitted: 2 posts to go out, the next at 9:00 AM"));
  assert.equal(log.filter((l) => l.startsWith("told:")).length, 1);
  assert.match(log.find((l) => l.startsWith("told:")), /It quits by itself once they are out/);
  assert.ok(!log.includes("quit 0"));
  // A minute on, one has gone: the tray says what is left. Then the last goes, and so does knitted.
  await bg.tick();
  assert.ok(log.includes("tip: knitted: 1 post to go out at 9:30 AM"));
  assert.ok(!log.includes("quit 0"));
  await bg.tick();
  assert.deepEqual(log.slice(-2), ["tray gone", "quit 0"]);
});

test("opening the window again takes the tray away", async () => {
  const { bg, log } = fakes([{ waiting: 1, next: iso(9), stayOpen: true }]);
  await bg.allClosed();
  bg.shown();
  assert.ok(!bg.background);
  assert.equal(log.at(-1), "tray gone");
  await bg.tick();
  assert.ok(!log.includes("quit 0"), "with its window open it does not quit by itself");
});

test("the person can turn it off: then closing quits even with posts waiting", async () => {
  const { bg, log } = fakes([{ waiting: 4, next: iso(9), stayOpen: false }]);
  await bg.allClosed();
  assert.deepEqual(log, ["quit 0"]);
});

test("a server that does not answer means nothing can go out, so it quits", async () => {
  const { bg, log } = fakes([new Error("ECONNREFUSED")]);
  await bg.allClosed();
  assert.deepEqual(log, ["quit 0"]);
});

test("quitting with posts waiting asks first; Keep Running closes the window instead, and Quit quits", async () => {
  const { bg, log, e } = fakes([{ waiting: 1, next: iso(9), stayOpen: true }]);
  bg.start();
  await new Promise((r) => setImmediate(r));
  let stopped = 0;
  const event = { preventDefault: () => stopped++ };
  assert.equal(bg.beforeQuit(event), true, "not yet");
  assert.equal(stopped, 1);
  await new Promise((r) => setImmediate(r));
  assert.ok(log.includes("asked: 1 post to go out at 9:00 AM. Quit anyway?"));
  assert.ok(log.includes("window closed"), "Keep Running: the window closes and knitted stays");
  e.answer = 1;
  assert.equal(bg.beforeQuit(event), true);
  await new Promise((r) => setImmediate(r));
  assert.ok(log.includes("quit 0"), "Quit: it quits");
  bg.stop();
});

test("quitting with nothing waiting does not ask", async () => {
  const { bg, log } = fakes([{ waiting: 0, next: null, stayOpen: true }]);
  bg.start();
  await new Promise((r) => setImmediate(r));
  assert.equal(bg.beforeQuit({ preventDefault: () => assert.fail("it should quit") }), false);
  assert.ok(!log.some((l) => l.startsWith("asked")));
  bg.stop();
});
