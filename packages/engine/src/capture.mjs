// Pictures of a business's website, as its visitors see it: for the Brief's reference.
//
// Each page the site reader found (core's crawl.ts) is opened in the browser knitting draws
// with, at a desktop's width and at a phone's, scrolled through so what loads as it is
// reached has loaded, and pictured the whole way down (to a length that stays readable).
// The pictures go on the project's reference shelf, in Website/Desktop and Website/Mobile,
// each saying which page it shows; taken again, a page's picture is replaced, so the
// reference always shows the site as it is now. A person or a model can crop a section out
// of one into Yarn, or look at it while drawing something new.
//
// Unlike the reader, the browser runs a page's own JavaScript, so it is shut in: it reaches
// public addresses only (every request is checked the way a pasted link is), it has no
// cookies or storage of the person's (a new, empty context for each page), and service
// workers, downloads, pop-ups, dialogs and permissions are all refused.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import { assertPublicUrl, fetchPublic, importYarn, listYarn, sameSite, uploadTempPath } from "@knitted/core/node";
import { openBrowser } from "./renderer.mjs";

/**
 * The two sizes a page is pictured at, both at twice their pixels: a desktop picture at 1x
 * looked soft once cropped into a 1080 px post. `longest`: the most of a long page kept, in
 * CSS pixels; 8,000 at 2x is 16,000, inside WebP's limit of 16,383 a side.
 */
export const DEVICES = {
  desktop: { label: "Desktop", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false, longest: 8_000 },
  mobile: {
    label: "Mobile", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, longest: 8_000,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 knitted.studio",
  },
};
const DESKTOP_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 knitted.studio";

const isPublic = (u) => assertPublicUrl(`${u.protocol}//${u.host}/`).then(() => true, () => false);

/** A request the shut-in browser may make: to a public address (`allow` says, once a host), or to data it already has. */
function gate(allow) {
  const hosts = new Map();
  return async (route) => {
    let u;
    try { u = new URL(route.request().url()); } catch { return route.abort("blockedbyclient"); }
    if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    if (u.protocol !== "https:" && u.protocol !== "http:") return route.abort("blockedbyclient");
    let ok = hosts.get(u.host);
    if (!ok) { ok = allow(u); hosts.set(u.host, ok); }
    return (await ok) ? route.continue() : route.abort("blockedbyclient");
  };
}

// What a page is named in the reference: its title, without the site's name after it.
function nameFor(p, siteName, device) {
  const path = new URL(p.url).pathname;
  let t = String(p.title ?? "").replace(/\s+/g, " ").trim();
  if (siteName && t.length > siteName.length) t = t.replace(new RegExp(`\\s*[|\\u2013\\u2014\\u00b7:\\u2022-]\\s*${siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "").trim();
  const parts = path.split("/").filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  if (!t) t = parts.length ? parts.at(-1).replace(/[-_]+/g, " ") : "Home";
  // Where it is on the site, to tell two pages with one title apart. A name has no slashes in it.
  const where = parts.join(" › ");
  return `${t.slice(0, 90)}${where ? ` (${where.length > 28 ? `${where.slice(0, 27)}…` : where})` : ""}, ${DEVICES[device].label.toLowerCase()}`;
}

/** Scroll down a page and back, so what loads as it is reached (pictures, sections that fade in) is there. */
async function settle(page, longest) {
  await page.evaluate(async (max) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < Math.min(document.documentElement.scrollHeight, max); y += step) { window.scrollTo(0, y); await wait(120); }
    window.scrollTo(0, 0);
    await wait(250);
    await Promise.race([Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), wait(4000)]);
    if (document.fonts?.ready) await Promise.race([document.fonts.ready, wait(2000)]);
  }, longest);
}

/**
 * Picture each page at each size, into the project's reference. `pages`: what the site reader
 * read, the most important first. Returns each picture made and each that could not be.
 */
export async function captureSite(store, projectId, pages, { devices = ["desktop", "mobile"], siteName = "", signal, onShot = () => {}, concurrency = 2, browser: given, allow = isPublic } = {}) {
  store.getProject(projectId);
  const list = pages.flatMap((p) => devices.map((device) => ({ ...p, device })));
  const shots = [], skipped = [];
  if (!list.length) return { shots, skipped };
  const start = new URL(pages[0].url);
  const browser = given ?? (await openBrowser());
  const before = new Map(listYarn(store, projectId, { shelf: "reference" }).filter((y) => y.meta.site).map((y) => [`${y.meta.site.url} ${y.meta.site.device}`, y]));
  let next = 0, done = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, async () => {
      for (let i = next++; i < list.length; i = next++) {
        if (signal?.aborted) return;
        const p = list[i], d = DEVICES[p.device];
        let context;
        try {
          context = await browser.newContext({
            viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor, isMobile: d.isMobile, hasTouch: d.hasTouch, userAgent: d.userAgent ?? DESKTOP_AGENT,
            serviceWorkers: "block", acceptDownloads: false, reducedMotion: "reduce", colorScheme: "light", locale: "en-US", javaScriptEnabled: true,
          });
          await context.route("**/*", gate(allow));
          await context.routeWebSocket?.(/.*/, (ws) => ws.close());
          const page = await context.newPage();
          page.on("dialog", (dlg) => dlg.dismiss().catch(() => {}));
          context.on("page", (other) => { if (other !== page) other.close().catch(() => {}); });
          const res = await page.goto(p.url, { waitUntil: "load", timeout: 30_000 });
          if (res && res.status() >= 400) throw new Error(`it answered ${res.status()}`);
          if (!sameSite(new URL(page.url()), start)) throw new Error("it led off the site");
          await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
          await settle(page, d.longest);
          const full = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
          const height = Math.max(d.viewport.height, Math.min(full, d.longest));
          const png = await page.screenshot({ type: "png", fullPage: true, animations: "disabled", clip: { x: 0, y: 0, width: d.viewport.width, height }, timeout: 30_000 });
          const webp = await sharp(png).webp({ quality: 88 }).toBuffer();
          const tmp = uploadTempPath(store, projectId);
          await mkdir(dirname(tmp), { recursive: true });
          await writeFile(tmp, webp);
          const had = before.get(`${p.url} ${p.device}`);
          const r = await importYarn(store, projectId, tmp, `${nameFor(p, siteName, p.device)}.webp`, {
            ...(had && !had.deletedAt ? { replaceId: had.id } : { shelf: "reference", folder: `Website/${d.label}`, tags: ["website", p.device] }),
            name: nameFor(p, siteName, p.device), actor: "import", quiet: true, site: { url: p.url, device: p.device, at: new Date().toISOString() },
          });
          shots.push({ yarnId: r.yarn.id, url: p.url, device: p.device, replaced: !!had, cut: full > d.longest });
        } catch (e) {
          if (signal?.aborted) return;
          skipped.push({ url: p.url, device: p.device, why: String(e?.message ?? e).split("\n")[0].replace(/^page\.goto:\s*/, "").slice(0, 200) });
        } finally {
          await context?.close().catch(() => {});
          done++;
          onShot({ url: p.url, device: p.device, done, total: list.length });
        }
      }
    }));
  } finally {
    if (!given) await browser.close().catch(() => {});
  }
  return { shots, skipped };
}

/**
 * A fetcher for the site reader (core's readWebsite) that reads each page as a visitor sees it:
 * fetched as before, then, when it is a web page, opened in the shut-in browser, scrolled
 * through, and read from what is drawn. Sites built with React and the like fill whole
 * sections in by JavaScript: notch.fm's "Works with" band, which says Spotify is planned, is
 * an empty box in the page as it arrives, so a Brief built from that said it worked with
 * Spotify. robots.txt and the sitemap are read as they arrive. When a page cannot be drawn,
 * it is read as it arrived. Close it when the reading is done.
 */
export async function renderingFetcher({ browser: given, allow = isPublic, fetcher = fetchPublic } = {}) {
  const browser = given ?? (await openBrowser());
  const get = async (url, o) => {
    const first = await fetcher(url, o);
    const html = first.buf.toString("utf8", 0, Math.min(first.buf.length, 4000));
    if (!/html/.test(o.accept) || first.status >= 400 || (!/html/.test(first.type) && !/<(html|head|body)\b/i.test(html))) return first;
    let context;
    try {
      context = await browser.newContext({ viewport: DEVICES.desktop.viewport, userAgent: DESKTOP_AGENT, serviceWorkers: "block", acceptDownloads: false, reducedMotion: "reduce", locale: "en-US", javaScriptEnabled: true });
      await context.route("**/*", gate(allow));
      await context.routeWebSocket?.(/.*/, (ws) => ws.close());
      const page = await context.newPage();
      page.on("dialog", (dlg) => dlg.dismiss().catch(() => {}));
      context.on("page", (other) => { if (other !== page) other.close().catch(() => {}); });
      await page.goto(first.url.href, { waitUntil: "load", timeout: o.timeoutMs ?? 20_000 });
      await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
      await settle(page, 12_000);
      const drawn = await page.content();
      const at = new URL(page.url());
      if (!sameSite(at, first.url)) return first;
      return { ...first, url: at, buf: Buffer.from(drawn, "utf8").subarray(0, o.max), truncated: Buffer.byteLength(drawn) > o.max, type: "text/html" };
    } catch {
      return first; // it could not be drawn: as it arrived is still something
    } finally {
      await context?.close().catch(() => {});
    }
  };
  return { fetcher: get, close: () => (given ? Promise.resolve() : browser.close().catch(() => {})) };
}
