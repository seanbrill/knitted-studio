// Posting to the person's own accounts on Instagram, TikTok, LinkedIn, Threads, X and
// YouTube, through the developer apps they made on each (docs/user/social.md says how).

export { SocialError, makeHttp } from "./http.mjs";
export { ADAPTERS, DEFAULT_CONFIG, appCredentials, forgetTokens, freshTokens, hostFor, setSocialConfig, socialConfig, socialView } from "./accounts.mjs";
export { finishConnect, isPending, readPasted, redirectFor, startConnect } from "./oauth.mjs";
export { AHEAD_MS, GRACE_MS, cancelScheduled, keepFresh, publishPost, runDue, startScheduler } from "./publish.mjs";
export { fileFreakHost, objectUrl, s3Host, signV4, testHost } from "./host.mjs";
export { prepareMedia } from "./media.mjs";
export { littleText } from "./platforms/linkedin.mjs";
export { chunks } from "./platforms/tiktok.mjs";
