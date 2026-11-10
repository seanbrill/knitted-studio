// Connecting an account: the person signs in on the platform's own page, in their browser,
// and the platform sends them back with a code, which knitted swaps for tokens.
//
// Back where? A desktop app has no web address. TikTok and Google send the browser straight
// to this computer (http://127.0.0.1:<port>/api/social/callback). The others need an https
// page: knitted's site has one (apps/site/app/oauth), which hands the code on to this
// computer, the port read from the `state` knitted gave. If the browser will not go there,
// that page shows the code to paste into Settings instead.
//
// `state` is a one-time number knitted made for this sign-in: a code that comes back
// without one it is waiting for is refused, so no other page can connect an account here.

import { randomBytes } from "node:crypto";
import { PLATFORMS, SITE_CALLBACK, appCallback } from "@knitted/core";
import { saveAccount } from "@knitted/core/node";
import { ADAPTERS, appCredentials, saveTokens } from "./accounts.mjs";
import { SocialError, challengeHex, challengeS256, makeHttp, verifier as newVerifier } from "./http.mjs";

const g = globalThis;
g.__knittedSocialPending ??= new Map();
const pending = g.__knittedSocialPending;
const FOR = 15 * 60_000;

export const redirectFor = (platform, port) => (PLATFORMS[platform].redirect === "site" ? SITE_CALLBACK : appCallback(port, platform));

/**
 * The address to send the person to, to sign in: through the platform's app, or its second app (`slot`, LinkedIn's for pages).
 * @param {any} store
 * @param {string} platform
 * @param {{ port: number | string, slot?: string | null }} where
 * @param {any} [deps]
 */
export async function startConnect(store, platform, { port, slot = null }, deps = {}) {
  const adapter = ADAPTERS[platform];
  if (!adapter) throw new SocialError("knitted does not post there.");
  const { clientId, configId } = await appCredentials(store, platform, deps, slot);
  for (const [k, v] of pending) if (Date.now() - v.at > FOR) pending.delete(k);
  const nonce = randomBytes(16).toString("hex");
  const verifier = adapter.pkce ? newVerifier() : null;
  const redirectUri = redirectFor(platform, port);
  pending.set(nonce, { platform, slot, verifier, redirectUri, at: Date.now() });
  const state = `${nonce}.${port}`;
  const challenge = adapter.pkce === "hex" ? challengeHex(verifier) : adapter.pkce ? challengeS256(verifier) : undefined;
  return { url: adapter.authorizeUrl({ clientId, redirectUri, state, challenge, configId, slot }), state };
}

/** Whether a sign-in with this state is one knitted is waiting for. */
export const isPending = (state) => pending.has(String(state ?? "").split(".")[0]);

/**
 * What the site's page shows to paste, back into what came with the browser: the query it
 * was given, as it was, or a link to that page.
 */
export function readPasted(text) {
  const t = String(text ?? "").trim();
  let q;
  try { q = new URL(t).searchParams; } catch { q = new URLSearchParams(t.replace(/^\?/, "")); }
  return { code: q.get("code"), state: q.get("state"), error: q.get("error"), errorDescription: q.get("error_description") };
}

/**
 * The code is back: swap it for tokens, ask who it is, and keep the account. One sign-in can
 * be for several accounts (Meta's Unified login gives a business's token for each Instagram
 * account picked, and LinkedIn's app for pages one for each page): each is kept, with the
 * same tokens, and the first is returned, with the names of all of them in `connected`.
 */
export async function finishConnect(store, { code, state, error, errorDescription }, deps = {}) {
  const nonce = String(state ?? "").split(".")[0];
  const p = pending.get(nonce);
  if (!p) throw new SocialError("knitted was not waiting for this sign-in, or it took longer than 15 minutes. Press Connect in Settings, Social, and sign in again.");
  pending.delete(nonce);
  const name = PLATFORMS[p.platform].name;
  const adapter = ADAPTERS[p.platform];
  if (error) throw new SocialError(error === "access_denied" || error === "user_cancelled" || error === "user_cancelled_login" || error === "user_cancelled_authorize" ? `You did not allow knitted on ${name}, so nothing was connected.` : adapter.signInError?.(error, errorDescription, p.slot) ?? `${name} did not connect: ${errorDescription || error}.`);
  if (!code) throw new SocialError(`${name} sent no code back. Press Connect and try again.`);
  const http = deps.http ?? makeHttp({ fetch: deps.fetch });
  const exchanged = await adapter.exchange(http, { ...(await appCredentials(store, p.platform, deps, p.slot)), code, redirectUri: p.redirectUri, verifier: p.verifier, slot: p.slot });
  // Which app it came through, to be renewed by the same one.
  const tokens = p.slot ? { ...exchanged, app: p.slot } : exchanged;
  const found = await adapter.me(http, tokens, { slot: p.slot });
  let first = null;
  const connected = [];
  for (const me of Array.isArray(found) ? found : [found]) {
    const account = saveAccount(store, {
      platform: p.platform, externalId: String(me.externalId), name: me.name, handle: me.handle, avatar: me.avatar,
      scopes: String(tokens.scope ?? "").split(/[\s,]+/).filter(Boolean),
      // A sign-in that cannot be renewed ends when its token does: Settings says when.
      expiresAt: adapter.canRefresh && !adapter.canRefresh(tokens) && tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : null,
    });
    await saveTokens(store, account.id, tokens, deps);
    first ??= account;
    connected.push(account.handle ? `@${account.handle}` : account.name);
  }
  if (!first) throw new SocialError(`${name} gave knitted no account. Press Connect and try again.`);
  return { ...first, connected };
}
