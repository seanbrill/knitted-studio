// Instagram and Threads, both Meta's: an app's Instagram or Threads product, the person's own
// account added to it as a tester, so no review is needed. Neither takes a file sent to it:
// each fetches it from a public address, which the person's media host gives (host.mjs).
// A post is made as a container, which Meta fetches and checks, then published.
//
// Sign-ins last an hour, then are swapped for ones that last 60 days, renewed once a day old.
//
// Instagram has a second way in, Meta's Unified login, for apps Meta made from late October
// 2026: those have no Instagram app ID, and Instagram's own sign-in turns them away as an
// "invalid platform app". With a Configuration ID from the app's "API setup with Unified login",
// the person signs in on Facebook, picks their business and Instagram accounts, and knitted
// gets a token for the business's system user. It does not run out unless the configuration
// says so, covers every account the business gave knitted, and works on graph.facebook.com.

import { SocialError, expiry, form } from "../http.mjs";

function explainer(name) {
  return (status, body) => {
    const e = body?.error ?? {};
    const said = e.error_user_msg || e.message || body?.error_message || body?.error_description;
    const code = Number(e.code), sub = Number(e.error_subcode);
    // Facebook's sign-in turns a Meta app set as a native or desktop app away when knitted swaps the code, which only a web app's secret may do.
    if (/configured as a desktop app/i.test(said ?? "")) return { message: `Meta turned the sign-in away because your Meta app is set up as a desktop app. In the Meta app, open App settings, Advanced, and under Security set "Native or desktop app?" to No. Save the change, then connect ${name} again.`, code: "desktop", retry: false };
    if (code === 190 || status === 401) return { message: `${name} stopped taking knitted's sign-in. Connect ${name} again in Settings, Social.`, reconnect: true, code: "auth" };
    if (code === 9004 || sub === 2207052) return { message: `${name} could not fetch the file from your media host. Check its public address works (Settings, Social, Test).`, code: "fetch", retry: false };
    if (code === 9 || sub === 2207042) return { message: `${name} says this account has posted as much as it may today. Post it tomorrow.`, code: "limit", retry: false };
    if (code === 4 || code === 17 || code === 32 || code === 613) return { message: `${name} is limiting how fast knitted may ask. Try again in a while.`, retry: true };
    return { message: said ? `${name} said: ${said}` : undefined, code: e.code ? String(e.code) : null };
  };
}

/**
 * Wait for a container to be ready to publish. Pictures take seconds; a video, as long as
 * Meta takes to fetch and check it, which it asks to be given up to five minutes.
 */
async function ready(http, ctx, url, field, fail) {
  for (let n = 0; ; n++) {
    const s = await http.json(url, {}, ctx);
    const st = s[field];
    if (st === "FINISHED" || st === "PUBLISHED") return;
    if (st === "ERROR" || st === "EXPIRED") throw new SocialError(`${ctx.name} could not use it: ${s.error_message ?? s.status ?? fail}.`);
    if (n >= 100) throw new SocialError(`${ctx.name} took more than five minutes to take the file. Try posting it again.`, { retry: true });
    await http.wait(3000);
  }
}

function graph({ name, host, version, authHost, scopes, exchangeGrant, refreshGrant, me, mediaPath, publishPath, statusField, textField }) {
  const ctx = { name, explain: explainer(name) };
  const api = `https://${host}/${version}`;
  // A Unified login's token works on Facebook's Graph, with the same calls.
  const apiOf = (t) => (t?.via === "unified" ? `https://graph.facebook.com/${version}` : api);
  const q = (t, o = {}) => new URLSearchParams({ ...o, access_token: t.access });
  return {
    scopes, pkce: null, ctx, api, apiOf,
    authorizeUrl({ clientId, redirectUri, state }) {
      return `https://${authHost}/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: scopes.join(","), state })}`;
    },
    async exchange(http, { clientId, clientSecret, code, redirectUri }) {
      const tokenHost = name === "Instagram" ? "api.instagram.com" : host;
      const short = await http.json(`https://${tokenHost}/oauth/access_token`, { method: "POST", body: form({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code: code.replace(/#_$/, "") }) }, ctx);
      const access = short.access_token ?? short.data?.[0]?.access_token;
      const long = await http.json(`https://${host}/access_token?${new URLSearchParams({ grant_type: exchangeGrant, client_secret: clientSecret, access_token: access })}`, {}, ctx);
      return { access: long.access_token, refresh: null, expiresAt: expiry(long.expires_in ?? 60 * 86400), issuedAt: Date.now(), scope: scopes.join(",") };
    },
    /** Renewed when it has a week left: Meta renews one only once it is a day old. */
    async refresh(http, { tokens: t }) {
      if (t.issuedAt && Date.now() - t.issuedAt < 86400_000) return t;
      const r = await http.json(`https://${host}/refresh_access_token?${new URLSearchParams({ grant_type: refreshGrant, access_token: t.access })}`, {}, ctx);
      return { ...t, access: r.access_token, expiresAt: expiry(r.expires_in ?? 60 * 86400), issuedAt: Date.now() };
    },
    refreshBefore: 7 * 86400_000,
    async me(http, t) { return me(http, ctx, api, t, q); },
    /** Make a container with these fields, and wait for Meta to have fetched what it points at. */
    async container(http, c, fields) {
      const r = await http.json(`${apiOf(c.tokens)}/${c.account.externalId}/${mediaPath}`, { method: "POST", body: form({ ...fields, access_token: c.tokens.access }) }, ctx);
      await ready(http, ctx, `${apiOf(c.tokens)}/${r.id}?${q(c.tokens, { fields: statusField === "status_code" ? "status_code,status" : "status,error_message" })}`, statusField, "it would not say why");
      return r.id;
    },
    async publishContainer(http, c, id) {
      c.commit();
      const r = await http.json(`${apiOf(c.tokens)}/${c.account.externalId}/${publishPath}`, { method: "POST", body: form({ creation_id: id, access_token: c.tokens.access }) }, ctx);
      let url = null;
      try { url = (await http.json(`${apiOf(c.tokens)}/${r.id}?${q(c.tokens, { fields: "permalink" })}`, {}, ctx)).permalink ?? null; } catch { /* the post is out; its link is a nicety */ }
      return { externalId: r.id, url };
    },
    /** A post's lifetime numbers, by Meta's names. One Meta has none of yet is left out, not 0. */
    async insights(http, t, id, metrics) {
      const r = await http.json(`${apiOf(t)}/${id}/insights?${q(t, { metric: metrics.join(",") })}`, {}, ctx);
      return Object.fromEntries((r.data ?? []).filter((d) => d.values?.length).map((d) => [d.name, Number(d.values[0].value)]));
    },
    textField,
  };
}

/** Meta's names for what it counts, as knitted keeps them. */
const META_NAMES = { views: "views", reach: "reach", likes: "likes", comments: "comments", replies: "comments", saved: "saves", shares: "shares", reposts: "reposts", quotes: "quotes" };
const fromMeta = (got) => {
  const m = {};
  for (const [k, v] of Object.entries(got)) if (META_NAMES[k] && Number.isFinite(v)) m[META_NAMES[k]] = v;
  if (Number.isFinite(got.ig_reels_avg_watch_time)) m.avgWatchSec = got.ig_reels_avg_watch_time / 1000;
  return m;
};

const ig = graph({
  name: "Instagram", host: "graph.instagram.com", version: "v27.0", authHost: "www.instagram.com",
  scopes: ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights"],
  exchangeGrant: "ig_exchange_token", refreshGrant: "ig_refresh_token", mediaPath: "media", publishPath: "media_publish", statusField: "status_code", textField: "caption",
  // Ids are asked for as strings: an Instagram id can be larger than a JSON number holds.
  async me(http, ctx, api, t, q) {
    const r = await http.json(`${api}/me?${q(t, { fields: "user_id,username,name,profile_picture_url" })}`, {}, ctx);
    return { externalId: String(r.user_id ?? r.id), name: r.name ?? "", handle: r.username ?? "", avatar: r.profile_picture_url ?? null };
  },
});

/** The Instagram accounts a Unified login's token was given, each with its name and picture where Meta gives them. */
async function unifiedAccounts(http, t) {
  const api = ig.apiOf(t), ctx = ig.ctx;
  const q = (o) => new URLSearchParams({ ...o, access_token: t.access });
  let found = [];
  // The business's system user: the accounts the person picked for knitted. A person's token
  // (a configuration made for one) has none, and finds them through the Pages they run instead.
  try { found = ((await http.json(`${api}/me/assigned_instagram_accounts?${q({ fields: "id,username" })}`, {}, ctx)).data ?? []).filter((a) => a.id); } catch (e) { if (e.reconnect) throw e; }
  if (!found.length) {
    try {
      const pages = (await http.json(`${api}/me/accounts?${q({ fields: "instagram_business_account{id,username,name,profile_picture_url}" })}`, {}, ctx)).data ?? [];
      found = pages.map((p) => p.instagram_business_account).filter((a) => a?.id);
    } catch (e) { if (e.reconnect) throw e; }
  }
  if (!found.length) throw new SocialError("Meta gave knitted no Instagram account. In your Meta app, open the configuration (API setup with Unified login), add your Instagram account as its asset and the business_management permission, then connect again and pick the account.");
  const out = [];
  for (const a of found) {
    let more = a;
    if (!a.name && !a.profile_picture_url) { try { more = { ...a, ...(await http.json(`${api}/${a.id}?${q({ fields: "name,username,profile_picture_url" })}`, {}, ctx)) }; } catch { /* its id and handle are enough */ } }
    out.push({ externalId: String(a.id), name: more.name ?? "", handle: more.username ?? a.username ?? "", avatar: more.profile_picture_url ?? null });
  }
  return out;
}

export const instagram = {
  id: "instagram", ...ig,
  /** With a Configuration ID, Meta's Unified login: Facebook's sign-in for the app's own App ID, and no list of permissions (the configuration has them). */
  authorizeUrl({ clientId, redirectUri, state, configId }) {
    if (!configId) return ig.authorizeUrl({ clientId, redirectUri, state });
    return `https://www.facebook.com/dialog/oauth?${new URLSearchParams({ client_id: clientId, config_id: configId, redirect_uri: redirectUri, response_type: "code", override_default_response_type: "true", state })}`;
  },
  async exchange(http, o) {
    if (!o.configId) return ig.exchange(http, o);
    const api = ig.apiOf({ via: "unified" });
    const got = await http.json(`${api}/oauth/access_token?${new URLSearchParams({ client_id: o.clientId, client_secret: o.clientSecret, redirect_uri: o.redirectUri, code: o.code.replace(/#_=?_?$/, "") })}`, {}, ig.ctx);
    if (!got.access_token) throw new SocialError("Facebook gave knitted no sign-in for Instagram. Press Connect and try again.");
    let t = { access: got.access_token, refresh: null, expiresAt: expiry(got.expires_in), issuedAt: Date.now(), scope: "", via: "unified" };
    // The business's token does not run out. A person's runs out in hours, so it is swapped for one that lasts 60 days.
    if (got.expires_in && got.expires_in < 7 * 86400) {
      const long = await http.json(`${api}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: o.clientId, client_secret: o.clientSecret, fb_exchange_token: got.access_token })}`, {}, ig.ctx);
      if (long.access_token) t = { ...t, access: long.access_token, expiresAt: expiry(long.expires_in ?? 60 * 86400) };
    }
    return t;
  },
  /** Instagram's own sign-in renews; a Unified login's does not, and needs none unless its configuration sets an end. */
  canRefresh: (t) => t.via !== "unified",
  async refresh(http, o) { return o.tokens.via === "unified" ? o.tokens : ig.refresh(http, o); },
  /** Who signed in: with a Unified login, every account the business gave knitted. */
  async me(http, t) { return t.via === "unified" ? unifiedAccounts(http, t) : ig.me(http, t); },
  async publish(http, c) {
    const tall = (m) => m.width / m.height < 0.79;
    const [one] = c.media;
    if (c.media.length === 1) {
      const story = one.kind === "image" && tall(one);
      const fields = one.kind === "video"
        ? { media_type: "REELS", video_url: one.url, caption: c.post.caption, share_to_feed: c.post.options?.shareToFeed === false ? "false" : "true" }
        : story ? { media_type: "STORIES", image_url: one.url } : { image_url: one.url, caption: c.post.caption, ...(c.post.options?.alt?.[0] ? { alt_text: String(c.post.options.alt[0]) } : {}) };
      const r = await this.publishContainer(http, c, await this.container(http, c, fields));
      // A Story's numbers go with it after a day, so they are asked for sooner (core's STORY_AGES).
      return story ? { ...r, options: { story: true } } : r;
    }
    const children = [];
    for (const [i, m] of c.media.entries()) children.push(await this.container(http, c, m.kind === "video" ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: "true" } : { image_url: m.url, is_carousel_item: "true", ...(c.post.options?.alt?.[i] ? { alt_text: String(c.post.options.alt[i]) } : {}) }));
    return this.publishContainer(http, c, await this.container(http, c, { media_type: "CAROUSEL", children: children.join(","), caption: c.post.caption }));
  },
  /**
   * How a post is doing. Each kind of post has its own numbers; one Meta does not take for
   * it is an error for the lot, so then the counts on the post itself are read instead.
   */
  async metrics(http, c) {
    const { post, tokens } = c;
    const story = !!post.options.story, reel = post.options.shape?.kind === "video";
    const want = story ? ["views", "reach", "replies", "shares"] : ["views", "reach", "likes", "comments", "saved", "shares", ...(reel ? ["ig_reels_avg_watch_time"] : [])];
    try {
      return { metrics: fromMeta(await this.insights(http, tokens, post.externalId, want)) };
    } catch (e) {
      if (/\(#10\)|not enough viewers/i.test(e.message)) return { metrics: null, note: "Instagram shows a Story's numbers once 5 people have seen it." };
      if (story && /\(#100\)|does not exist|expired/i.test(e.message)) return { metrics: null, note: "Instagram keeps a Story's numbers only while the Story is up, for a day." };
      if (e.reconnect) throw e;
      const r = await http.json(`${this.apiOf(tokens)}/${post.externalId}?${new URLSearchParams({ fields: "like_count,comments_count", access_token: tokens.access })}`, {}, this.ctx);
      const m = {};
      if (Number.isFinite(r.like_count)) m.likes = r.like_count;
      if (Number.isFinite(r.comments_count)) m.comments = r.comments_count;
      return { metrics: m, note: `Instagram gave only its likes and comments: ${e.message}` };
    }
  },
};

const th = graph({
  name: "Threads", host: "graph.threads.com", version: "v1.0", authHost: "threads.com",
  scopes: ["threads_basic", "threads_content_publish", "threads_manage_insights"],
  exchangeGrant: "th_exchange_token", refreshGrant: "th_refresh_token", mediaPath: "threads", publishPath: "threads_publish", statusField: "status", textField: "text",
  async me(http, ctx, api, t, q) {
    const r = await http.json(`${api}/me?${q(t, { fields: "id,username,name,threads_profile_picture_url" })}`, {}, ctx);
    return { externalId: String(r.id), name: r.name ?? "", handle: r.username ?? "", avatar: r.threads_profile_picture_url ?? null };
  },
});

export const threads = {
  id: "threads", ...th,
  async publish(http, c) {
    const text = c.post.caption;
    const item = (m, i, carousel) => ({
      ...(m.kind === "video" ? { media_type: "VIDEO", video_url: m.url } : { media_type: "IMAGE", image_url: m.url }),
      ...(carousel ? { is_carousel_item: "true" } : { text }),
      ...(m.kind === "image" && c.post.options?.alt?.[i] ? { alt_text: String(c.post.options.alt[i]) } : {}),
    });
    if (!c.media.length) return this.publishContainer(http, c, await this.container(http, c, { media_type: "TEXT", text }));
    if (c.media.length === 1) return this.publishContainer(http, c, await this.container(http, c, item(c.media[0], 0, false)));
    const children = [];
    for (const [i, m] of c.media.entries()) children.push(await this.container(http, c, item(m, i, true)));
    return this.publishContainer(http, c, await this.container(http, c, { media_type: "CAROUSEL", children: children.join(","), text }));
  },
  async metrics(http, c) {
    return { metrics: fromMeta(await this.insights(http, c.tokens, c.post.externalId, ["views", "likes", "replies", "reposts", "quotes", "shares"])) };
  },
};
