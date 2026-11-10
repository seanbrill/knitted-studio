// The person's developer apps, their accounts' sign-ins, and their media host.
//
// What is not secret is a setting ("social"): each platform's client id, the media host's
// bucket and addresses, and whether their model may schedule. What is secret goes to the OS's
// secret store, never the database: each app's client secret, each account's tokens, and
// the media host's key. Nothing here returns a secret to the studio's pages.

import { deleteSecret, getAccount, getSecret, secretStatus, setAccountState, setSecret } from "@knitted/core/node";
import { PLATFORM_IDS } from "@knitted/core";
import { SocialError } from "./http.mjs";
import { instagram, threads } from "./platforms/meta.mjs";
import { linkedin } from "./platforms/linkedin.mjs";
import { tiktok } from "./platforms/tiktok.mjs";
import { x } from "./platforms/x.mjs";
import { youtube } from "./platforms/youtube.mjs";
import { fileFreakHost, s3Host } from "./host.mjs";

export const ADAPTERS = { instagram, tiktok, linkedin, threads, x, youtube };

export const DEFAULT_CONFIG = {
  apps: Object.fromEntries(PLATFORM_IDS.map((p) => [p, { clientId: "" }])),
  host: { kind: "none", s3: { endpoint: "", region: "auto", bucket: "", keyId: "", publicBase: "", prefix: "knitted/" }, filefreak: { folder: "knitted posts" } },
  /** Off: the person's model makes drafts, which the person schedules. On: it may schedule them itself. */
  modelMaySchedule: false,
  /** X charges for each read of a post's numbers, so they are asked for only when this is on. */
  metricsX: false,
  /** The desktop app keeps running, without its window, while posts are waiting to go out. */
  stayOpen: true,
};

const KEY = {
  app: (p) => `social_app_${p}`,
  token: (id) => `social_token_${id}`,
  s3: "social_host_s3",
  filefreak: "social_host_filefreak",
};

export function socialConfig(store) {
  const c = store.getSetting("social", {});
  return {
    ...DEFAULT_CONFIG, ...c,
    apps: Object.fromEntries(PLATFORM_IDS.map((p) => [p, { ...DEFAULT_CONFIG.apps[p], ...(c.apps?.[p] ?? {}) }])),
    host: { ...DEFAULT_CONFIG.host, ...(c.host ?? {}), s3: { ...DEFAULT_CONFIG.host.s3, ...(c.host?.s3 ?? {}) }, filefreak: { ...DEFAULT_CONFIG.host.filefreak, ...(c.host?.filefreak ?? {}) } },
  };
}

/** Change the settings, and set or clear the secrets that go with them. */
export async function setSocialConfig(store, change, deps = {}) {
  const c = socialConfig(store);
  const dir = store.paths.root;
  const next = { ...c };
  for (const k of ["modelMaySchedule", "metricsX", "stayOpen"]) if (change[k] !== undefined) next[k] = !!change[k];
  for (const [p, a] of Object.entries(change.apps ?? {})) {
    if (!ADAPTERS[p]) continue;
    if (a.clientId !== undefined) next.apps[p] = { ...next.apps[p], clientId: String(a.clientId).trim() };
    // Instagram through Meta's Unified login: the configuration that says what knitted may do.
    if (a.configId !== undefined && p === "instagram") next.apps[p] = { ...next.apps[p], configId: String(a.configId).trim() };
    if (a.clientSecret) await setSecret(KEY.app(p), a.clientSecret, dir, deps.secrets);
    if (a.clearSecret) await deleteSecret(KEY.app(p), dir, deps.secrets);
  }
  if (change.host) {
    const h = change.host;
    next.host = { ...next.host, ...(h.kind ? { kind: h.kind } : {}), s3: { ...next.host.s3, ...pick(h.s3, ["endpoint", "region", "bucket", "keyId", "publicBase", "prefix"]) }, filefreak: { ...next.host.filefreak, ...pick(h.filefreak, ["folder"]) } };
    if (h.s3?.secret) await setSecret(KEY.s3, h.s3.secret, dir, deps.secrets);
    if (h.filefreak?.apiKey) await setSecret(KEY.filefreak, h.filefreak.apiKey, dir, deps.secrets);
  }
  store.setSetting("social", next);
  return next;
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, String(o[k]).trim()]));

/** The settings, with whether each secret is there, and never the secret. */
export async function socialView(store, deps = {}) {
  const c = socialConfig(store);
  const dir = store.paths.root;
  const apps = {};
  for (const p of PLATFORM_IDS) apps[p] = { clientId: c.apps[p].clientId, secret: (await secretStatus(KEY.app(p), dir, deps.secrets)).present, ...(p === "instagram" ? { configId: c.apps[p].configId ?? "" } : {}) };
  return {
    apps, modelMaySchedule: c.modelMaySchedule, metricsX: c.metricsX, stayOpen: c.stayOpen,
    host: { ...c.host, s3: { ...c.host.s3, secret: (await secretStatus(KEY.s3, dir, deps.secrets)).present }, filefreak: { ...c.host.filefreak, apiKey: (await secretStatus(KEY.filefreak, dir, deps.secrets)).present } },
  };
}

/** A platform's app: its id and secret, or a refusal saying what to set up. */
export async function appCredentials(store, platform, deps = {}) {
  const c = socialConfig(store).apps[platform];
  const secret = await getSecret(KEY.app(platform), store.paths.root, deps.secrets);
  const optional = platform === "x";
  if (!c.clientId || (!secret && !optional)) throw new SocialError(`Set up your ${ADAPTERS[platform] ? platformName(platform) : platform} app first: its client id${optional ? "" : " and secret"}, in Settings, Social.`);
  return { clientId: c.clientId, clientSecret: secret ?? null, configId: c.configId || null };
}
const platformName = (p) => ({ instagram: "Instagram", tiktok: "TikTok", linkedin: "LinkedIn", threads: "Threads", x: "X", youtube: "YouTube" })[p];

export const saveTokens = (store, accountId, t, deps = {}) => setSecret(KEY.token(accountId), JSON.stringify(t), store.paths.root, deps.secrets);
export const forgetTokens = (store, accountId, deps = {}) => deleteSecret(KEY.token(accountId), store.paths.root, deps.secrets);

const g = globalThis;
g.__knittedSocialRefreshing ??= new Map();

/**
 * An account's tokens, renewed first when they are about to run out. One renewal at a time
 * per account: X's refresh tokens work once, and two at once would lose the account. A
 * platform that stops taking them marks the account, for Settings to ask the person to
 * connect it again.
 */
export async function freshTokens(store, accountId, http, deps = {}) {
  const pending = g.__knittedSocialRefreshing.get(accountId);
  if (pending) return pending;
  const run = (async () => {
    const a = getAccount(store, accountId);
    const adapter = ADAPTERS[a.platform];
    const raw = await getSecret(KEY.token(accountId), store.paths.root, deps.secrets);
    const fail = (message) => { setAccountState(store, accountId, { status: "reconnect", note: message }); return new SocialError(message, { reconnect: true }); };
    if (!raw) throw fail(`knitted no longer has this account's sign-in. Connect ${platformName(a.platform)} again in Settings, Social.`);
    const t = JSON.parse(raw);
    const now = deps.now?.() ?? Date.now();
    const before = adapter.refreshBefore ?? 5 * 60_000;
    if (!t.expiresAt || t.expiresAt - now > before) return t;
    if (adapter.canRefresh && !adapter.canRefresh(t)) {
      if (t.expiresAt > now) return t;
      throw fail(`${platformName(a.platform)}'s sign-in ran out. Connect it again in Settings, Social.`);
    }
    try {
      const next = await adapter.refresh(http, { ...(await appCredentials(store, a.platform, deps)), tokens: t });
      if (next !== t) await saveTokens(store, accountId, next, deps);
      if (a.status !== "ok") setAccountState(store, accountId, { status: "ok", note: null });
      return next;
    } catch (e) {
      if (e?.reconnect) throw fail(e.message);
      // Not renewed, but not yet run out: post with what there is.
      if (t.expiresAt > now) return t;
      throw e;
    }
  })();
  g.__knittedSocialRefreshing.set(accountId, run);
  try { return await run; } finally { g.__knittedSocialRefreshing.delete(accountId); }
}

/** The media host the person set up, or null. */
export async function hostFor(store, deps = {}) {
  const h = socialConfig(store).host;
  const dir = store.paths.root;
  if (h.kind === "s3") {
    const secret = await getSecret(KEY.s3, dir, deps.secrets);
    if (!h.s3.bucket || !h.s3.keyId || !secret || !h.s3.publicBase) throw new SocialError("Your media host is not finished: it needs a bucket, a key id and secret, and the public address its files are read at (Settings, Social).");
    return s3Host(h.s3, secret, { fetch: deps.fetch });
  }
  if (h.kind === "filefreak") {
    const key = await getSecret(KEY.filefreak, dir, deps.secrets);
    if (!key) throw new SocialError("Your media host is FileFreak, but it has no key yet (Settings, Social).");
    return fileFreakHost(h.filefreak, key, { fetch: deps.fetch });
  }
  return null;
}
