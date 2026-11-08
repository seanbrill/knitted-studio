// YouTube, through Google's sign-in for a desktop app: the browser comes back to this
// computer on any port, so nothing is registered. YouTube is the one platform that can be
// told when to publish: a post scheduled far enough ahead is uploaded at once, private, with
// its time, and YouTube makes it public then, whether or not this computer is on.

import { readFile } from "node:fs/promises";
import { SocialError, bearer, expiry, form } from "../http.mjs";

const name = "YouTube";
const API = "https://www.googleapis.com/youtube/v3";

const REASONS = {
  quotaExceeded: "Your Google app has used its YouTube allowance for today. It starts again at midnight, Pacific time.",
  uploadLimitExceeded: "YouTube says this channel has uploaded as many videos as it may today. Post it tomorrow.",
  youtubeSignupRequired: "This Google account has no YouTube channel yet. Make one at youtube.com, then connect again.",
  invalidPublishAt: "YouTube needs a time in the future to publish at.",
  forbidden: "YouTube refused it. Check the app may upload: in Google Cloud, YouTube Data API v3 is on.",
};

function explain(status, body) {
  if (body?.error === "invalid_grant") return { message: "Google stopped taking knitted's sign-in. If your Google app is still in Testing, its sign-ins last 7 days: publish it (Google Auth Platform, Audience), then connect YouTube again.", reconnect: true };
  const reason = body?.error?.errors?.[0]?.reason;
  if (REASONS[reason]) return { message: REASONS[reason], code: reason, retry: false };
  if (status === 401) return { message: "Google stopped taking knitted's sign-in. Connect YouTube again in Settings, Social.", reconnect: true };
  const said = body?.error?.message ?? body?.error_description;
  return { message: said ? `YouTube said: ${said}` : undefined, code: reason ?? null };
}
const ctx = { name, explain };

export const youtube = {
  id: "youtube",
  // force-ssl, not upload alone: a scheduled video can then be moved or taken back.
  scopes: ["https://www.googleapis.com/auth/youtube.force-ssl", "https://www.googleapis.com/auth/yt-analytics.readonly"],
  pkce: "s256",
  authorizeUrl({ clientId, redirectUri, state, challenge }) {
    return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: this.scopes.join(" "), state, code_challenge: challenge, code_challenge_method: "S256", access_type: "offline", prompt: "consent" })}`;
  },
  async exchange(http, { clientId, clientSecret, code, redirectUri, verifier }) {
    const r = await http.json("https://oauth2.googleapis.com/token", { method: "POST", body: form({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri }) }, ctx);
    return { access: r.access_token, refresh: r.refresh_token ?? null, expiresAt: expiry(r.expires_in), scope: r.scope ?? "" };
  },
  async refresh(http, { clientId, clientSecret, tokens: t }) {
    if (!t.refresh) throw new SocialError("Google's sign-in ran out. Connect YouTube again in Settings, Social.", { reconnect: true });
    const r = await http.json("https://oauth2.googleapis.com/token", { method: "POST", body: form({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: t.refresh }) }, ctx);
    return { ...t, access: r.access_token, expiresAt: expiry(r.expires_in), refresh: r.refresh_token ?? t.refresh };
  },
  async me(http, t) {
    const r = await http.json(`${API}/channels?part=snippet&mine=true`, { headers: bearer(t) }, ctx);
    const ch = r.items?.[0];
    if (!ch) throw new SocialError(REASONS.youtubeSignupRequired);
    return { externalId: ch.id, name: ch.snippet?.title ?? "", handle: (ch.snippet?.customUrl ?? "").replace(/^@/, ""), avatar: ch.snippet?.thumbnails?.default?.url ?? null };
  },
  /** `publishAt`: upload it private now, for YouTube to make public then. */
  async publish(http, c, { publishAt } = {}) {
    const v = c.media[0];
    const o = c.post.options ?? {};
    const buf = await readFile(v.path);
    const meta = {
      snippet: { title: c.post.title.slice(0, 100), description: c.post.caption, categoryId: String(o.category ?? "22"), ...(o.tags?.length ? { tags: o.tags } : {}) },
      status: {
        privacyStatus: publishAt ? "private" : (o.privacy ?? "public"), ...(publishAt ? { publishAt } : {}),
        selfDeclaredMadeForKids: !!o.madeForKids, containsSyntheticMedia: !!o.aiLabel,
      },
    };
    const start = await http.call("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST", headers: bearer(c.tokens, { "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(buf.length), "x-upload-content-type": v.mime }), body: JSON.stringify(meta),
    }, ctx);
    const session = start.headers.get("location");
    if (!session) throw new SocialError("YouTube did not say where to send the video. Try posting it again.", { retry: true });
    c.commit();
    const r = await (await http.call(session, { method: "PUT", headers: { "content-type": v.mime }, body: buf }, ctx)).json();
    const short = v.height >= v.width && (v.durationMs ?? 0) <= 180_000;
    return { externalId: r.id, url: r.id ? (short ? `https://www.youtube.com/shorts/${r.id}` : `https://www.youtube.com/watch?v=${r.id}`) : null };
  },
  /** Take back a video uploaded to publish later. */
  async remove(http, t, id) {
    await http.call(`${API}/videos?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: bearer(t) }, ctx);
  },
};
