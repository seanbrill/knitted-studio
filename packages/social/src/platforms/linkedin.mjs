// LinkedIn, two ways, each through an app of the person's own:
//
// - As the person: "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect",
//   which any developer app can add for itself. A sign-in lasts 60 days and is not renewed
//   without the person, so the account says when it runs out (Settings, Social).
// - As a company page (the "pages" app): the Community Management API, which LinkedIn adds
//   to an app only once it has approved the business. One sign-in by an admin of the pages
//   gives an account for each page they may post as. LinkedIn gives each app its own id for
//   a person, so the two never share an account, and the pages app keeps only the pages.

import { readFile } from "node:fs/promises";
import { isLinkedInPage } from "@knitted/core";
import { SocialError, bearer, expiry, form } from "../http.mjs";

const REST = "https://api.linkedin.com/rest";
// LinkedIn's API is versioned by month, and each version lives about a year.
export const LINKEDIN_VERSION = "202610";
const name = "LinkedIn";

function explain(status, body) {
  const said = body?.message ?? body?.error_description ?? body?.error;
  if (status === 401 || body?.error === "invalid_grant") return { message: "LinkedIn's sign-in ran out (it lasts 60 days). Connect LinkedIn again in Settings, Social.", reconnect: true };
  if (status === 426) return { message: "This copy of knitted speaks a version of LinkedIn's API that LinkedIn has retired. Update knitted, then post it again.", retry: false };
  if (status === 403) return { message: `LinkedIn refused it${said ? `: ${said}` : ""}. Check the app has its product: Share on LinkedIn to post as you, or the Community Management API to post as a page, and that you are still an admin of the page.`, retry: false };
  return { message: said ? `LinkedIn said: ${said}` : undefined };
}
const ctx = { name, explain };
const rest = (t, extra = {}) => bearer(t, { "linkedin-version": LINKEDIN_VERSION, "x-restli-protocol-version": "2.0.0", ...extra });

/**
 * LinkedIn reads a post's text as "little text": these characters mean something to it, so
 * each is written with a backslash, and a #word becomes a real hashtag.
 */
export function littleText(text) {
  return text.split(/(#[\p{L}\p{N}_]+)/u).map((part, i) => (i % 2 ? `{hashtag|\\#|${part.slice(1)}}` : part.replace(/[|{}@[\]()<>#\\*_~]/g, (c) => `\\${c}`))).join("");
}

/** What each app asks for: the person's own posts, or their pages' (and which pages those are). */
const SCOPES = { you: ["openid", "profile", "w_member_social"], pages: ["rw_organization_admin", "w_organization_social"] };
const scopesFor = (slot) => SCOPES[slot === "pages" ? "pages" : "you"];
/** The roles on a page that LinkedIn lets post as it. */
const POSTERS = new Set(["ADMINISTRATOR", "CONTENT_ADMINISTRATOR", "CONTENT_ADMIN", "DIRECT_SPONSORED_CONTENT_POSTER"]);

export const linkedin = {
  id: "linkedin",
  scopes: SCOPES.you,
  scopesFor,
  // A post's numbers need LinkedIn's Community Management API, which it grants only to
  // registered businesses, on an app with no other products. So: no metrics() here.
  noMetrics: "LinkedIn gives a post's numbers only to apps it has approved for businesses, so knitted cannot show them. See them on the post.",
  pkce: null,
  authorizeUrl({ clientId, redirectUri, state, slot }) {
    return `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, state, scope: scopesFor(slot).join(" ") })}`;
  },
  /** LinkedIn sends the person back with an error when the app lacks a product it asked for: say which. */
  signInError(error, description, slot) {
    if (!/scope/i.test(`${error ?? ""} ${description ?? ""}`)) return null;
    return slot === "pages"
      ? "Your LinkedIn app for pages does not have the Community Management API yet. LinkedIn adds it to the app once it approves your request (the app's Products tab says when). Until then, knitted can post as you, through the app under You."
      : "Your LinkedIn app is missing a product knitted needs. On its Products tab, add Share on LinkedIn and Sign In with LinkedIn using OpenID Connect, then connect again.";
  },
  async exchange(http, { clientId, clientSecret, code, redirectUri, slot }) {
    const r = await http.json("https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", body: form({ grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }) }, ctx);
    return { access: r.access_token, refresh: r.refresh_token ?? null, expiresAt: expiry(r.expires_in), refreshExpiresAt: expiry(r.refresh_token_expires_in), scope: r.scope ?? scopesFor(slot).join(",") };
  },
  async refresh(http, { clientId, clientSecret, tokens: t }) {
    if (!t.refresh) throw new SocialError("LinkedIn's sign-in ran out (it lasts 60 days). Connect LinkedIn again in Settings, Social.", { reconnect: true });
    const r = await http.json("https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", body: form({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: clientId, client_secret: clientSecret }) }, ctx);
    return { access: r.access_token, refresh: r.refresh_token ?? t.refresh, expiresAt: expiry(r.expires_in), refreshExpiresAt: expiry(r.refresh_token_expires_in) ?? t.refreshExpiresAt ?? null, scope: r.scope ?? t.scope };
  },
  /** LinkedIn gives a self-serve app no refresh token: its sign-in ends when the token does. */
  canRefresh: (t) => !!t.refresh,
  async me(http, t, { slot } = {}) {
    if (slot === "pages") return pages(http, t);
    const r = await http.json("https://api.linkedin.com/v2/userinfo", { headers: bearer(t) }, ctx);
    return { externalId: r.sub, name: r.name ?? [r.given_name, r.family_name].filter(Boolean).join(" "), handle: "", avatar: r.picture ?? null };
  },
  async publish(http, c) {
    // A page's account is the page itself; a person's is their id, made into theirs.
    const page = isLinkedInPage(c.account);
    const author = page ? c.account.externalId : `urn:li:person:${c.account.externalId}`;
    const alt = (i) => (c.post.options?.alt?.[i] ? { altText: String(c.post.options.alt[i]).slice(0, 4086) } : {});
    let content;
    const images = c.media.filter((m) => m.kind === "image"), video = c.media.find((m) => m.kind === "video");
    if (video) content = { media: { id: await uploadVideo(http, c, author, video), title: (c.post.title || c.media[0].label || "").slice(0, 200) } };
    else if (images.length === 1) content = { media: { id: await uploadImage(http, c, author, images[0]), ...alt(0) } };
    else if (images.length > 1) {
      const ids = [];
      for (const m of images) ids.push(await uploadImage(http, c, author, m));
      content = { multiImage: { images: ids.map((id, i) => ({ id, ...alt(i) })) } };
    }
    const body = {
      // A page has followers, not connections: it posts to anyone.
      author, commentary: littleText(c.post.caption), visibility: !page && c.post.options?.visibility === "CONNECTIONS" ? "CONNECTIONS" : "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false, ...(content ? { content } : {}),
    };
    c.commit();
    const res = await http.call(`${REST}/posts`, { method: "POST", headers: rest(c.tokens, { "content-type": "application/json" }), body: JSON.stringify(body) }, ctx);
    const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
    return { externalId: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : null };
  },
};

/**
 * The pages the person who signed in may post as: those they are an admin or content admin
 * of, each by its name. LinkedIn tells an admin a page's name; a content admin's is looked
 * up, and failing that the page is named by its number.
 */
async function pages(http, t) {
  const acls = await http.json(`${REST}/organizationAcls?q=roleAssignee&state=APPROVED&count=100`, { headers: rest(t) }, ctx);
  const ids = [];
  for (const e of acls.elements ?? []) {
    const urn = e.organization ?? e.organizationTarget ?? e.organizationalTarget;
    if (typeof urn !== "string" || !urn.startsWith("urn:li:organization:") || !POSTERS.has(e.role) || (e.state && e.state !== "APPROVED") || ids.includes(urn)) continue;
    ids.push(urn);
  }
  const out = [];
  for (const urn of ids) {
    const id = urn.slice("urn:li:organization:".length);
    let org = null;
    try { org = await http.json(`${REST}/organizations/${encodeURIComponent(id)}`, { headers: rest(t) }, ctx); }
    catch { try { org = (await http.json(`${REST}/organizationsLookup?ids=List(${encodeURIComponent(id)})`, { headers: rest(t) }, ctx)).results?.[id] ?? null; } catch { /* named by its number */ } }
    out.push({ externalId: urn, name: org?.localizedName || org?.vanityName || `LinkedIn page ${id}`, handle: "", avatar: null });
  }
  if (!out.length) throw new SocialError("LinkedIn lists no page you can post as. You have to be an admin or a content admin of the page: a super admin of the page can make you one on LinkedIn, under the page's Settings, Manage admins. Then connect again.");
  return out;
}

async function uploadImage(http, c, owner, m) {
  const init = await http.json(`${REST}/images?action=initializeUpload`, { method: "POST", headers: rest(c.tokens, { "content-type": "application/json" }), body: JSON.stringify({ initializeUploadRequest: { owner } }) }, ctx);
  await http.call(init.value.uploadUrl, { method: "PUT", headers: bearer(c.tokens, { "content-type": m.mime }), body: await readFile(m.path) }, ctx);
  return init.value.image;
}

async function uploadVideo(http, c, owner, m) {
  const buf = await readFile(m.path);
  const init = await http.json(`${REST}/videos?action=initializeUpload`, { method: "POST", headers: rest(c.tokens, { "content-type": "application/json" }), body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: buf.length, uploadCaptions: false, uploadThumbnail: false } }) }, ctx);
  const v = init.value;
  const etags = [];
  // Each part to its own address, with no sign-in: the address is the permission.
  for (const part of v.uploadInstructions ?? []) {
    const res = await http.call(part.uploadUrl, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: buf.subarray(part.firstByte, part.lastByte + 1) }, ctx);
    etags.push(res.headers.get("etag"));
  }
  await http.call(`${REST}/videos?action=finalizeUpload`, { method: "POST", headers: rest(c.tokens, { "content-type": "application/json" }), body: JSON.stringify({ finalizeUploadRequest: { video: v.video, uploadToken: v.uploadToken ?? "", uploadedPartIds: etags } }) }, ctx);
  for (let n = 0; ; n++) {
    const s = await http.json(`${REST}/videos/${encodeURIComponent(v.video)}`, { headers: rest(c.tokens) }, ctx);
    if (s.status === "AVAILABLE") return v.video;
    if (s.status === "PROCESSING_FAILED") throw new SocialError(`LinkedIn could not use the video${s.processingFailureReason ? `: ${s.processingFailureReason}` : ""}.`);
    if (n > 60) throw new SocialError("LinkedIn took too long to process the video. Try posting it again.", { retry: true });
    await http.wait(5000);
  }
}
