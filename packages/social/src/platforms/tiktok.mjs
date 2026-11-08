// TikTok, through Login Kit for desktop and the Content Posting API's Direct Post. The video
// is sent from this computer (FILE_UPLOAD), so no media host is needed. Until TikTok audits
// the person's app, a post is seen only by its owner, and the account has to be private.
//
// TikTok's own rules for an app that posts, which its review checks: the person picks the
// privacy each time, from what TikTok offers (nothing picked for them), and comments, duets
// and stitches are off until they turn them on (the Post dialog does this).

import { readFile } from "node:fs/promises";
import { SocialError, bearer, expiry, form } from "../http.mjs";

const API = "https://open.tiktokapis.com/v2";
const name = "TikTok";

const WORDS = {
  access_token_invalid: ["TikTok stopped taking knitted's sign-in. Connect TikTok again in Settings, Social.", true],
  scope_not_authorized: ["TikTok's sign-in does not allow posting. Connect TikTok again, and allow everything it asks.", true],
  unaudited_client_can_only_post_to_private_accounts: ["TikTok posts from an app it has not reviewed only to a private account. Make the account private in TikTok, or have the app reviewed, then post it again.", false],
  spam_risk_too_many_posts: ["TikTok says this account has posted as much as it may today. Post it tomorrow.", false],
  spam_risk_user_banned_from_posting: ["TikTok is not letting this account post right now.", false],
  privacy_level_option_mismatch: ["That privacy is not one TikTok offers this account now. Pick another in the post.", false],
  rate_limit_exceeded: ["TikTok is limiting how fast knitted may ask. Try again in a while.", false],
};

function explain(status, body) {
  const e = body?.error;
  const code = typeof e === "object" ? e?.code : e;
  if (WORDS[code]) return { message: WORDS[code][0], reconnect: WORDS[code][1], code, retry: code === "rate_limit_exceeded" };
  if (code === "invalid_grant") return { message: WORDS.access_token_invalid[0], reconnect: true, code };
  const said = (typeof e === "object" ? e?.message : body?.error_description) || null;
  return { message: said ? `TikTok said: ${said}` : undefined, code };
}
const ctx = { name, explain };

/** TikTok can answer 200 and still refuse: its error.code says. */
function checked(r) {
  const code = r?.error?.code;
  if (code && code !== "ok") {
    const w = explain(200, r);
    throw new SocialError(w.message ?? `TikTok refused it (${code}).`, { code, reconnect: w.reconnect, retry: w.retry });
  }
  return r;
}
const tokens = (r, t = {}) => ({ access: r.access_token, refresh: r.refresh_token ?? t.refresh ?? null, expiresAt: expiry(r.expires_in), refreshExpiresAt: expiry(r.refresh_expires_in) ?? t.refreshExpiresAt ?? null, openId: r.open_id ?? t.openId, scope: r.scope ?? t.scope ?? "" });

/** Bytes in each part: TikTok takes 5 to 64 MB a part, the last up to 128, and a file under 5 MB whole. */
export function chunks(size, part = 10 * 1024 * 1024) {
  if (size <= part) return { chunkSize: size, count: 1 };
  return { chunkSize: part, count: Math.floor(size / part) };
}

export const tiktok = {
  id: "tiktok",
  scopes: ["user.info.basic", "video.publish", "video.upload", "video.list", "user.info.stats"],
  pkce: "hex",
  authorizeUrl({ clientId, redirectUri, state, challenge }) {
    return `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({ client_key: clientId, response_type: "code", scope: this.scopes.join(","), redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: "S256" })}`;
  },
  async exchange(http, { clientId, clientSecret, code, redirectUri, verifier }) {
    const r = await http.json(`${API}/oauth/token/`, { method: "POST", body: form({ client_key: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: verifier }) }, ctx);
    if (r.error) checked({ error: { code: r.error, message: r.error_description } });
    return tokens(r);
  },
  async refresh(http, { clientId, clientSecret, tokens: t }) {
    const r = await http.json(`${API}/oauth/token/`, { method: "POST", body: form({ client_key: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: t.refresh }) }, ctx);
    if (r.error) checked({ error: { code: r.error === "invalid_grant" ? "access_token_invalid" : r.error, message: r.error_description } });
    return tokens(r, t);
  },
  async creator(http, t) {
    const r = checked(await http.json(`${API}/post/publish/creator_info/query/`, { method: "POST", headers: bearer(t, { "content-type": "application/json; charset=UTF-8" }) }, ctx));
    return r.data;
  },
  async me(http, t) {
    const d = await this.creator(http, t);
    return { externalId: t.openId, name: d.creator_nickname ?? "", handle: d.creator_username ?? "", avatar: d.creator_avatar_url ?? null };
  },
  async publish(http, c) {
    const v = c.media[0];
    const o = c.post.options ?? {};
    if (!o.privacy) throw new SocialError("Pick who can see it on TikTok, in the post.");
    const buf = await readFile(v.path);
    const { chunkSize, count } = chunks(buf.length);
    const init = checked(await http.json(`${API}/post/publish/video/init/`, {
      method: "POST", headers: bearer(c.tokens, { "content-type": "application/json; charset=UTF-8" }),
      body: JSON.stringify({
        post_info: {
          title: c.post.caption, privacy_level: o.privacy,
          disable_comment: !o.comments, disable_duet: !o.duet, disable_stitch: !o.stitch,
          brand_content_toggle: !!o.brandedContent, brand_organic_toggle: !!o.yourBrand, is_aigc: !!o.aiLabel,
        },
        source_info: { source: "FILE_UPLOAD", video_size: buf.length, chunk_size: chunkSize, total_chunk_count: count },
      }),
    }, ctx));
    const { publish_id: publishId, upload_url: uploadUrl } = init.data;
    for (let i = 0; i < count; i++) {
      const from = i * chunkSize, to = i === count - 1 ? buf.length - 1 : from + chunkSize - 1;
      if (i === count - 1) c.commit(); // the last part in, TikTok posts it
      await http.call(uploadUrl, { method: "PUT", headers: { "content-type": "video/mp4", "content-range": `bytes ${from}-${to}/${buf.length}` }, body: buf.subarray(from, to + 1) }, ctx);
    }
    const profile = c.account.handle ? `https://www.tiktok.com/@${c.account.handle}` : null;
    for (let n = 0; n < 100; n++) {
      await http.wait(3000);
      const s = checked(await http.json(`${API}/post/publish/status/fetch/`, { method: "POST", headers: bearer(c.tokens, { "content-type": "application/json; charset=UTF-8" }), body: JSON.stringify({ publish_id: publishId }) }, ctx)).data ?? {};
      if (s.status === "FAILED") throw new SocialError(`TikTok could not post it: ${(s.fail_reason ?? "it did not say why").replaceAll("_", " ")}.`);
      if (s.status === "PUBLISH_COMPLETE") {
        const id = s.publicaly_available_post_id?.[0];
        return id
          ? { externalId: String(id), url: profile ? `${profile}/video/${id}` : null, options: { publishId } }
          : { externalId: publishId, url: profile, note: o.privacy === "SELF_ONLY" ? "Posted so only you can see it. TikTok gives no link to a private post." : null, options: { publishId } };
      }
    }
    return { externalId: publishId, url: profile, note: "TikTok has it and is still processing it. It shows on your profile when it is done.", options: { publishId } };
  },
  /**
   * How a video is doing. TikTok gives a video's id only once it is public and has passed its
   * checks, so a post kept by its publish id asks for the id first; until TikTok has reviewed
   * the person's app every post is private, and there is none.
   */
  async metrics(http, c) {
    const { post, tokens: t, account } = c;
    let id = post.externalId, url = post.url;
    if (/^v_(pub|inbox)_/.test(id) || id === post.options.publishId) {
      const s = checked(await http.json(`${API}/post/publish/status/fetch/`, { method: "POST", headers: bearer(t, { "content-type": "application/json; charset=UTF-8" }), body: JSON.stringify({ publish_id: post.options.publishId ?? id }) }, ctx)).data ?? {};
      const found = s.publicaly_available_post_id?.[0];
      if (!found) return { metrics: null, note: "TikTok gives numbers only for a public video, once it has checked it. Until TikTok has reviewed your app, what it posts is private." };
      id = String(found);
      url = account.handle ? `https://www.tiktok.com/@${account.handle}/video/${id}` : url;
    }
    const fields = "id,view_count,like_count,comment_count,share_count";
    const r = checked(await http.json(`${API}/video/query/?fields=${fields}`, { method: "POST", headers: bearer(t, { "content-type": "application/json; charset=UTF-8" }), body: JSON.stringify({ filters: { video_ids: [id] } }) }, ctx));
    const v = r.data?.videos?.find((x) => String(x.id) === id);
    const out = id !== post.externalId ? { externalId: id, url } : {};
    if (!v) return { ...out, metrics: null, note: "TikTok did not find the video: it may be private, or deleted." };
    const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : undefined);
    return { ...out, metrics: { views: n(v.view_count), likes: n(v.like_count), comments: n(v.comment_count), shares: n(v.share_count) } };
  },
};
