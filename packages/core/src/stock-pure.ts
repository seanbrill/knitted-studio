// Free stock, as the browser sees it: the sources knitted can search, what a result is, and
// the credit line for one. Browser-safe: the searching itself is stock.ts, on the server.

export type StockKind = "image" | "video" | "audio";
export type StockProvider = "openverse" | "pixabay" | "pexels";

/** One thing a search found. `id` is the source's own, after its name: "pexels:2014422". */
export interface StockItem {
  id: string;
  provider: StockProvider;
  kind: StockKind;
  title: string;
  /** A small picture of it, from the source, to show in a result. A sound has none. */
  thumb?: string;
  /** For video and sound: a short, small file to play before adding it. */
  preview?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  author?: string;
  authorUrl?: string;
  /** Its page on the source's site. */
  page: string;
  license: string;
  licenseUrl?: string;
  /** The source's own credit line for it, where it gives one (Openverse does). */
  attribution?: string;
}

export interface StockSource {
  provider: StockProvider;
  name: string;
  kinds: StockKind[];
  /** Null: it works without a key. Otherwise the place to get a free one. */
  keyUrl: string | null;
  site: string;
  /** What the browse page says under a search that used it, as the source asks. */
  attribution: string;
  /** Anything else to know before getting a key. */
  note?: string;
}

export const STOCK_SOURCES: Record<StockProvider, StockSource> = {
  openverse: { provider: "openverse", name: "Openverse", kinds: ["image", "audio"], keyUrl: null, site: "https://openverse.org", attribution: "Made using Openverse, which does not endorse or certify knitted. Openverse finds openly licensed work from across the web and does not check the licences: look at each one's, and credit its maker as it asks." },
  pixabay: { provider: "pixabay", name: "Pixabay", kinds: ["image", "video"], keyUrl: "https://pixabay.com/api/docs/", site: "https://pixabay.com", attribution: "Photos and videos from Pixabay." },
  pexels: { provider: "pexels", name: "Pexels", kinds: ["image", "video"], keyUrl: "https://www.pexels.com/api/", site: "https://www.pexels.com", attribution: "Photos and videos provided by Pexels.", note: "Pexels is not giving out new keys for now. A key you already have works here." },
};

const WORD: Record<StockKind, string> = { image: "Photo", video: "Video", audio: "Sound" };

/** The line to give with a file when it is used: "Photo by Ana Lee on Pexels (Pexels License)". */
export function creditLine(item: Pick<StockItem, "provider" | "kind" | "author" | "license">): string {
  const src = STOCK_SOURCES[item.provider].name;
  return `${WORD[item.kind]}${item.author ? ` by ${item.author}` : ""} on ${src}${item.license ? ` (${item.license})` : ""}`;
}

/** Whether a licence asks for its maker to be credited where the work is used. */
export const needsCredit = (license: string) => /\bBY\b/i.test(license) || /attribution/i.test(license);
