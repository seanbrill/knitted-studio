// What each platform takes, so a post is checked before it is scheduled, in the studio and
// for a model, and not refused by the platform at its time, with the person not there.
//
// The limits are the platforms' own (their API documentation, November 2026). Where a
// platform allows more than knitted needs (a 20-picture carousel), knitted asks for less.

export type Platform = "instagram" | "tiktok" | "linkedin" | "threads" | "x" | "youtube";
export const PLATFORM_IDS: Platform[] = ["instagram", "tiktok", "linkedin", "threads", "x", "youtube"];

export interface PlatformInfo {
  id: Platform;
  name: string;
  /** The longest caption, in the platform's own count (X counts a link as 23, an emoji as 2). */
  caption: number;
  /** The longest title, for a platform with one. */
  title?: number;
  /** The most pictures in one post. 0: it takes no pictures through its API. */
  images: number;
  /** The shortest and longest video, in ms. */
  videoMs: [number, number];
  /** Its sign-in comes back to the site's page, which hands it to the app ("site"), or straight to the app ("app"). */
  redirect: "site" | "app";
  /** Fetches the files from a public address, so a public media host is needed. */
  needsHost: boolean;
  /** Where its developer apps are made. */
  console: string;
  /** Can be set up without a client secret (X's native apps). */
  secretOptional?: boolean;
  /** Most hashtags. */
  hashtags?: number;
}

export const PLATFORMS: Record<Platform, PlatformInfo> = {
  instagram: { id: "instagram", name: "Instagram", caption: 2200, hashtags: 30, images: 10, videoMs: [3000, 15 * 60_000], redirect: "site", needsHost: true, console: "https://developers.facebook.com/apps/" },
  tiktok: { id: "tiktok", name: "TikTok", caption: 2200, images: 0, videoMs: [3000, 10 * 60_000], redirect: "app", needsHost: false, console: "https://developers.tiktok.com/apps/" },
  linkedin: { id: "linkedin", name: "LinkedIn", caption: 3000, images: 20, videoMs: [3000, 30 * 60_000], redirect: "site", needsHost: false, console: "https://www.linkedin.com/developers/apps" },
  threads: { id: "threads", name: "Threads", caption: 500, images: 10, videoMs: [0, 5 * 60_000], redirect: "site", needsHost: true, console: "https://developers.facebook.com/apps/" },
  x: { id: "x", name: "X", caption: 280, images: 4, videoMs: [500, 140_000], redirect: "site", needsHost: false, console: "https://console.x.com/", secretOptional: true },
  youtube: { id: "youtube", name: "YouTube", caption: 5000, title: 100, images: 0, videoMs: [1000, 12 * 3600_000], redirect: "app", needsHost: false, console: "https://console.cloud.google.com/apis/credentials" },
};

/** Where the site's page that hands a sign-in back to the app lives. Registered as the redirect for "site" platforms. */
export const SITE_CALLBACK = "https://knitted.filefreak.page/oauth/";
/** The app's own address for a sign-in to come back to. TikTok's examples end in a slash, and it matches exactly. */
export const appCallback = (port: number | string, platform: Platform) => `http://127.0.0.1:${port}/api/social/callback${platform === "tiktok" ? "/" : ""}`;
/** What to register as the redirect with each platform: TikTok takes a star for the port, Google needs nothing registered. */
export function redirectToRegister(platform: Platform, port: number | string): string | null {
  if (PLATFORMS[platform].redirect === "site") return SITE_CALLBACK;
  if (platform === "tiktok") return "http://127.0.0.1:*/api/social/callback/";
  void port;
  return null;
}

export type PostStatus = "draft" | "scheduled" | "posting" | "posted" | "failed" | "cancelled" | "missed";

/** How X counts: a link is 23, and anything outside the Latin and general punctuation ranges is 2. */
export function xLength(text: string): number {
  let n = 0;
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  let rest = text;
  for (const u of urls) { rest = rest.replace(u, ""); n += 23; }
  for (const ch of rest) {
    const c = ch.codePointAt(0)!;
    const light = c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

/** A caption's length as the platform counts it. YouTube counts the bytes of a description. */
export function captionLength(platform: Platform, text: string): number {
  if (platform === "x") return xLength(text);
  if (platform === "youtube") return new TextEncoder().encode(text).length;
  return [...text].length;
}

/** The caption with its hashtags after it, as it is posted. */
export function fullCaption(caption: string, hashtags: string[] = []): string {
  const tags = hashtags.map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`));
  const missing = tags.filter((t) => !caption.toLowerCase().includes(t.toLowerCase()));
  return [caption.trim(), missing.join(" ")].filter(Boolean).join("\n\n");
}

export interface PostMedia { kind: "image" | "video"; width: number; height: number; durationMs?: number | null }
export interface PostCheck {
  /** Each a reason the platform would refuse it. Nothing may be scheduled with one. */
  problems: string[];
  /** What it will do that the person may not expect, like a tall picture going to Stories. */
  notes: string[];
}

const secs = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 100) / 10} seconds`);

/** Whether a platform takes this post as it is, in words. */
export function checkPost(platform: Platform, media: PostMedia[], caption: string, title = ""): PostCheck {
  const p = PLATFORMS[platform];
  const problems: string[] = [], notes: string[] = [];
  const videos = media.filter((m) => m.kind === "video"), images = media.filter((m) => m.kind === "image");
  if (!media.length && platform !== "threads" && platform !== "x" && platform !== "linkedin") problems.push(`${p.name} needs a picture or a video to post.`);
  if (videos.length && images.length) problems.push("A post is one video or pictures, not both.");
  if (videos.length > 1) problems.push("A post takes one video.");
  if (images.length && !p.images) problems.push(`${p.name} takes videos only from knitted.${platform === "tiktok" ? " TikTok posts pictures only from an address it has verified, which a desktop app has not." : ""}`);
  else if (images.length > p.images) problems.push(`${p.name} takes up to ${p.images} pictures in one post; this has ${images.length}.`);
  for (const v of videos) {
    const d = v.durationMs ?? 0;
    if (d && d < p.videoMs[0]) problems.push(`${p.name} needs a video of at least ${secs(p.videoMs[0])}; this is ${secs(d)}.`);
    if (d > p.videoMs[1]) problems.push(`${p.name} takes videos up to ${secs(p.videoMs[1])}; this is ${secs(d)}.`);
  }
  const len = captionLength(platform, caption);
  if (len > p.caption) problems.push(`The ${platform === "youtube" ? "description" : "caption"} is ${len} long; ${p.name} takes ${p.caption}${platform === "x" ? ", counting a link as 23 and an emoji as 2" : ""}.`);
  if (p.hashtags && (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > p.hashtags) problems.push(`${p.name} takes up to ${p.hashtags} hashtags.`);
  if (platform === "youtube") {
    const t = title.trim();
    if (!t) problems.push("YouTube needs a title.");
    if ([...t].length > (p.title ?? 100)) problems.push(`The title is ${[...t].length} long; YouTube takes ${p.title}.`);
    if (/[<>]/.test(t)) problems.push("YouTube does not take < or > in a title.");
    const v = videos[0];
    if (v && v.height >= v.width && (v.durationMs ?? 0) <= 180_000) notes.push("YouTube shows it as a Short: it is upright and up to 3 minutes.");
  }
  if (platform === "instagram") {
    const one = media.length === 1 ? media[0] : null;
    const tall = (m: PostMedia) => m.width / m.height < 0.8 - 0.01, wide = (m: PostMedia) => m.width / m.height > 1.91 + 0.01;
    if (one?.kind === "image" && tall(one)) notes.push("Instagram feed pictures are 4:5 at their tallest, so this one goes to your Story.");
    else if (one?.kind === "image" && wide(one)) problems.push("Instagram feed pictures are 1.91:1 at their widest; this one is wider.");
    if (images.length > 1 && images.some((m) => tall(m) || wide(m))) problems.push("Every picture in an Instagram carousel has to be between 4:5 and 1.91:1.");
    if (one?.kind === "video") notes.push("Instagram posts a video as a Reel.");
  }
  if (platform === "tiktok") notes.push("Until TikTok has reviewed your app, what it posts is visible only to you, and your account has to be private.");
  return { problems, notes };
}
