// X, through its v2 API with OAuth 2.0 and PKCE. A native app has no secret; a web app's
// is sent as Basic auth. Access lasts two hours and each refresh token works once, so the
// new one is kept straight away (publish.mjs). Posting costs the person's own X credits.

import { readFile } from "node:fs/promises";
import { SocialError, bearer, expiry, form } from "../http.mjs";

const API = "https://api.x.com/2";
const name = "X";

function explain(status, body) {
  const said = body?.detail ?? body?.title ?? body?.errors?.[0]?.message ?? body?.error_description ?? body?.error;
  if (status === 402) return { message: "Your X developer account has no credits left to post with. Add some at console.x.com, then post it again.", retry: false };
  if (status === 401 || body?.error === "invalid_grant") return { message: "X stopped taking knitted's sign-in. Connect X again in Settings, Social.", reconnect: true };
  if (status === 403) return { message: `X refused it${said ? `: ${said}` : ""}. Check the app has Read and write permission at console.x.com.`, retry: false };
  return { message: said ? `X said: ${said}` : undefined };
}
const ctx = { name, explain };

function tokenAuth(clientId, clientSecret) {
  return clientSecret ? { authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}` } : {};
}
const tokens = (r) => ({ access: r.access_token, refresh: r.refresh_token ?? null, expiresAt: expiry(r.expires_in), scope: r.scope ?? "" });

export const x = {
  id: "x",
  scopes: ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"],
  pkce: "s256",
  authorizeUrl({ clientId, redirectUri, state, challenge }) {
    const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: this.scopes.join(" "), state, code_challenge: challenge, code_challenge_method: "S256" });
    return `https://x.com/i/oauth2/authorize?${q}`;
  },
  async exchange(http, { clientId, clientSecret, code, redirectUri, verifier }) {
    const r = await http.json(`${API}/oauth2/token`, { method: "POST", headers: tokenAuth(clientId, clientSecret), body: form({ code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: verifier, client_id: clientId }) }, ctx);
    return tokens(r);
  },
  async refresh(http, { clientId, clientSecret, tokens: t }) {
    if (!t.refresh) throw new SocialError("X's sign-in ran out. Connect X again in Settings, Social.", { reconnect: true });
    const r = await http.json(`${API}/oauth2/token`, { method: "POST", headers: tokenAuth(clientId, clientSecret), body: form({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: clientId }) }, ctx);
    return tokens(r);
  },
  async me(http, t) {
    const r = await http.json(`${API}/users/me?user.fields=profile_image_url`, { headers: bearer(t) }, ctx);
    return { externalId: r.data.id, name: r.data.name ?? "", handle: r.data.username ?? "", avatar: r.data.profile_image_url ?? null };
  },
  async publish(http, c) {
    const ids = [];
    for (const m of c.media) ids.push(m.kind === "video" ? await uploadVideo(http, c, m) : await uploadImage(http, c, m));
    c.commit();
    const r = await http.json(`${API}/tweets`, { method: "POST", headers: bearer(c.tokens, { "content-type": "application/json" }), body: JSON.stringify({ text: c.post.caption, ...(ids.length ? { media: { media_ids: ids } } : {}) }) }, ctx);
    const id = r.data?.id;
    return { externalId: id ?? null, url: id ? `https://x.com/${c.account.handle || "i"}/status/${id}` : null };
  },
  /**
   * How a post is doing: its public counts, which X gives for as long as the post is up.
   * Each look costs the person's X credits, so knitted asks only when they turned it on.
   */
  async metrics(http, c) {
    const r = await http.json(`${API}/tweets?${new URLSearchParams({ ids: c.post.externalId, "tweet.fields": "public_metrics" })}`, { headers: bearer(c.tokens) }, ctx);
    const p = r.data?.find((d) => d.id === c.post.externalId)?.public_metrics;
    if (!p) return { metrics: null, note: "X did not find the post: it may have been deleted." };
    return { metrics: { views: p.impression_count, likes: p.like_count, comments: p.reply_count, reposts: p.retweet_count ?? p.repost_count, quotes: p.quote_count, saves: p.bookmark_count } };
  },
};

async function uploadImage(http, c, m) {
  const fd = new FormData();
  fd.set("media", new Blob([await readFile(m.path)], { type: m.mime }), m.name);
  fd.set("media_category", "tweet_image");
  const r = await http.json(`${API}/media/upload`, { method: "POST", headers: bearer(c.tokens), body: fd }, ctx);
  return r.data?.id ?? r.media_id_string;
}

const CHUNK = 4 * 1024 * 1024;
async function uploadVideo(http, c, m) {
  const buf = await readFile(m.path);
  const init = await http.json(`${API}/media/upload/initialize`, { method: "POST", headers: bearer(c.tokens, { "content-type": "application/json" }), body: JSON.stringify({ media_type: m.mime, total_bytes: buf.length, media_category: "tweet_video" }) }, ctx);
  const id = init.data?.id;
  for (let i = 0, at = 0; at < buf.length; i++, at += CHUNK) {
    const fd = new FormData();
    fd.set("segment_index", String(i));
    fd.set("media", new Blob([buf.subarray(at, at + CHUNK)], { type: "application/octet-stream" }), m.name);
    await http.call(`${API}/media/upload/${id}/append`, { method: "POST", headers: bearer(c.tokens), body: fd }, ctx);
  }
  let info = (await http.json(`${API}/media/upload/${id}/finalize`, { method: "POST", headers: bearer(c.tokens) }, ctx)).data?.processing_info;
  // X processes a video before it can be posted: it says when to ask again.
  for (let n = 0; info && info.state !== "succeeded"; n++) {
    if (info.state === "failed") throw new SocialError(`X could not use the video: ${info.error?.message ?? "it would not process it"}.`);
    if (n > 60) throw new SocialError("X took too long to process the video. Try posting it again.", { retry: true });
    await http.wait(Math.min(10, Math.max(1, info.check_after_secs ?? 2)) * 1000);
    info = (await http.json(`${API}/media/upload?command=STATUS&media_id=${id}`, { headers: bearer(c.tokens) }, ctx)).data?.processing_info;
  }
  return id;
}
