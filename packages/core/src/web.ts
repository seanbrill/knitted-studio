// Reading a public website, as safely as a link can be read.
//
// Every address is checked to be public before it is asked for, and every redirect is
// followed one checked hop at a time, so a site can never be a way into the person's own
// computer or network. What comes back is bytes, read as text: nothing on a page ever runs.
// The swatch reader (swatch.ts) and the brief's site reader (crawl.ts) both read through here.

import { ValidationError } from "./store.ts";
import { assertPublicUrl } from "./yarn.ts";

// Some sites turn away a bare name, so this reads like the browser it stands in for.
export const AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 knitted.studio";

/** What a site's answer means for the person, when it is not the page. */
export function siteAnswer(status: number, what: string): ValidationError {
  if (status === 401 || status === 403 || status === 429) return new ValidationError(`That site turned knitted away (it answered ${status}). Some sites only let a browser in. Upload its logo to Yarn and pick colours from that instead.`);
  if (status === 404 || status === 410) return new ValidationError(`That ${what} is not there (it answered ${status}). Check the link opens in a browser.`);
  if (status >= 500) return new ValidationError(`That site had a problem of its own (it answered ${status}). Try again in a minute.`);
  return new ValidationError(`That site answered ${status}. Check the link opens in a browser.`);
}

export interface Fetched { buf: Buffer; url: URL; type: string; truncated: boolean; status: number; }
export interface FetchOptions { max: number; accept: string; timeoutMs?: number; what?: string; signal?: AbortSignal; }
/** How a reader asks for a page: fetchPublic, or a test's stand-in for it. */
export type Fetcher = (url: string, o: FetchOptions) => Promise<Fetched>;

/** Fetch a public address, following redirects one checked hop at a time, and keep the first `max` bytes. */
export async function fetchPublic(raw: string, { max, accept, timeoutMs = 15_000, what = "page", signal }: FetchOptions): Promise<Fetched> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 5; hop++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await fetch(url, { redirect: "manual", signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { "user-agent": AGENT, accept, "accept-language": "en" } });
    const to = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && to) { await res.body?.cancel(); url = await assertPublicUrl(new URL(to, url).href); continue; }
    if (!res.ok) { await res.body?.cancel(); throw Object.assign(siteAnswer(res.status, what), { status: res.status }); }
    const chunks: Uint8Array[] = []; let got = 0; let truncated = false;
    const reader = res.body?.getReader();
    for (;;) {
      const next = await reader?.read();
      if (!next || next.done) break;
      chunks.push(next.value); got += next.value.length;
      if (got > max) { truncated = true; await reader!.cancel(); break; }
    }
    return { buf: Buffer.concat(chunks).subarray(0, max), url, type: (res.headers.get("content-type") ?? "").toLowerCase(), truncated, status: res.status };
  }
  throw new ValidationError("That site redirected too many times.");
}

/** What a person typed as a site's address, made whole: "example.com" is https://example.com. */
export function siteAddress(raw: string): string {
  const typed = String(raw ?? "").trim();
  if (!typed) throw new ValidationError("Paste the address of the website, like https://example.com.");
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
}
