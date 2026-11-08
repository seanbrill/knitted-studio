// One way to call every platform. A test hands in its own fetch; KNITTED_SOCIAL_API sends
// every address to a stand-in for the platforms instead (the end-to-end tests' fakes), as
// <that address>/<host>/<path>. A refusal becomes a SocialError in words the person can act
// on: the platform's own reason, and whether signing in again or trying later would help.
//
// Nothing here writes a token, an address with a token in it, or a request body to a log or
// an error: an error says what the platform said, and nothing knitted sent.

import { createHash, randomBytes } from "node:crypto";

export class SocialError extends Error {
  /**
   * `reconnect`: the platform stopped taking the account's sign-in; the person has to sign in again.
   * `retry`: it failed for a passing reason (the network, the platform busy). Whether it is
   * safe to try again depends on whether the post itself was already sent (see publish.mjs).
   */
  constructor(message, { status = 0, code = null, reconnect = false, retry = false } = {}) {
    super(message);
    this.name = "SocialError";
    this.status = status; this.code = code; this.reconnect = reconnect; this.retry = retry;
  }
}

/** Form-encoded, as OAuth token endpoints and Meta's Graph API take it. */
export const form = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) p.set(k, String(v));
  return p;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `explain(status, body)`: the platform's own reason, from its error body, in a line, and
 * whether it means signing in again. Each platform module has one.
 */
export function makeHttp({ fetch: f = globalThis.fetch, base = process.env.KNITTED_SOCIAL_API, wait = sleep } = {}) {
  const at = (url) => (base ? `${base.replace(/\/$/, "")}/${String(url).replace(/^https?:\/\//, "")}` : String(url));
  async function call(url, init = {}, { name = "The platform", explain } = {}) {
    let res;
    try { res = await f(at(url), { redirect: "follow", ...init }); }
    catch (e) { throw new SocialError(`Could not reach ${name}: ${e?.cause?.code ?? e?.message ?? "no answer"}. Check the internet connection.`, { retry: true }); }
    if (res.ok || res.status === 308) return res;
    const text = await res.text().catch(() => "");
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    const said = explain?.(res.status, body, text) ?? {};
    const message = said.message ?? `${name} answered ${res.status}${text && !body ? `: ${text.slice(0, 200)}` : ""}.`;
    throw new SocialError(message, {
      status: res.status, code: said.code ?? null,
      reconnect: said.reconnect ?? res.status === 401,
      retry: said.retry ?? (res.status === 429 || res.status >= 500),
    });
  }
  async function json(url, init, ctx) {
    const res = await call(url, init, ctx);
    const text = await res.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { throw new SocialError(`${ctx?.name ?? "The platform"} answered with something that is not JSON.`, { retry: true }); }
  }
  return { call, json, at, wait };
}

// PKCE. The verifier is 43 characters of A-Z a-z 0-9 - _, which every platform takes.
export const verifier = () => randomBytes(32).toString("base64url");
export const challengeS256 = (v) => createHash("sha256").update(v).digest("base64url");
/** TikTok asks for the SHA-256 in hex, not base64url as RFC 7636 says. */
export const challengeHex = (v) => createHash("sha256").update(v).digest("hex");

/** Seconds from now as an epoch in ms, or null. */
export const expiry = (seconds) => (seconds ? Date.now() + Number(seconds) * 1000 : null);

export const bearer = (tokens, extra = {}) => ({ authorization: `Bearer ${tokens.access}`, ...extra });
