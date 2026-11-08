// Making photos and video with a provider, as the browser sees it: who can make what, their
// models, the shapes they make, and what a request will cost before it is made. Browser-safe:
// the making itself is generate.ts, on the server.
//
// Prices are the providers' published ones on 2026-11-07, in US dollars. A provider that
// reports what an answer used (OpenAI) is charged at that; one that does not (Google), at
// its price per picture or per second.

export type GenKind = "image" | "video";
export type GenProvider = "openai" | "google";
export type GenAspect = "1:1" | "4:5" | "9:16" | "16:9" | "3:2" | "2:3";
export type GenQuality = "draft" | "good" | "best";

export interface GenModel { id: string; name: string; note: string; kind: GenKind }
export interface GenSource {
  provider: GenProvider;
  name: string;
  kinds: GenKind[];
  keyUrl: string;
  models: GenModel[];
  /** What to know before using it: account steps, limits, what it adds to a file. */
  notes: string[];
}

export const GEN_SOURCES: Record<GenProvider, GenSource> = {
  openai: {
    provider: "openai", name: "OpenAI", kinds: ["image"], keyUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-image-2.6-flare", name: "GPT Image 2.6 Flare", note: "Fast, for everyday photos", kind: "image" },
      { id: "gpt-image-2.6-sunburst", name: "GPT Image 2.6 Sunburst", note: "Slower, for detail and for working from a reference", kind: "image" },
    ],
    notes: [
      "OpenAI may ask you to verify your organization before its image models work for your key.",
      "Its pictures carry Content Credentials (C2PA) and an invisible watermark saying they were made with AI.",
    ],
  },
  google: {
    provider: "google", name: "Google Gemini", kinds: ["image", "video"], keyUrl: "https://aistudio.google.com/apikey",
    models: [
      { id: "gemini-nano-banana-2.1", name: "Nano Banana 2.1", note: "Google's choice for new work, and the cheapest good one", kind: "image" },
      { id: "gemini-3-pro-image", name: "Gemini 3 Pro Image", note: "For detail, text in the picture and several references", kind: "image" },
      { id: "gemini-omni-1.2-flash", name: "Gemini Omni 1.2 Flash", note: "Video, 3 to 15 seconds, always with sound", kind: "video" },
    ],
    notes: [
      "A key on Google's paid tier: there is no free tier for pictures or video.",
      "Everything it makes carries an invisible SynthID watermark saying it was made with AI.",
      "Video comes in 16:9 or 9:16, and always has sound, which you steer in words.",
    ],
  },
};

export const GEN_ASPECTS: GenAspect[] = ["1:1", "4:5", "9:16", "16:9", "3:2", "2:3"];
export const VIDEO_ASPECTS: GenAspect[] = ["9:16", "16:9"];

/** The model to use when none is chosen. */
export const DEFAULT_MODEL: Record<GenProvider, Partial<Record<GenKind, string>>> = {
  openai: { image: "gpt-image-2.6-flare" },
  google: { image: "gemini-nano-banana-2.1", video: "gemini-omni-1.2-flash" },
};

/** OpenAI's width and height for a shape: each side a multiple of 16, within its limits. */
export const OPENAI_SIZE: Record<GenAspect, string> = { "1:1": "1024x1024", "4:5": "1024x1280", "9:16": "1152x2048", "16:9": "2048x1152", "3:2": "1536x1024", "2:3": "1024x1536" };
export const OPENAI_QUALITY: Record<GenQuality, "low" | "medium" | "high"> = { draft: "low", good: "medium", best: "high" };
/** Google's picture size for a quality. */
export const GOOGLE_SIZE: Record<GenQuality, "1K" | "2K" | "4K"> = { draft: "1K", good: "2K", best: "4K" };
export const VIDEO_RESOLUTION: Record<GenQuality, "360p" | "720p" | "1080p"> = { draft: "360p", good: "720p", best: "1080p" };

// Published prices: OpenAI's for gpt-image-2 by quality (square, then tall or wide), which the
// 2.5 and 2.6 models are charged like by the token; Google's per picture by size, and per
// second of video by resolution.
const OPENAI_EACH: Record<"low" | "medium" | "high", [number, number]> = { low: [0.006, 0.005], medium: [0.053, 0.041], high: [0.211, 0.165] };
const GOOGLE_EACH: Record<string, Record<"1K" | "2K" | "4K", number>> = {
  "gemini-nano-banana-2.1": { "1K": 0.0336, "2K": 0.0504, "4K": 0.113 },
  "gemini-3-pro-image": { "1K": 0.134, "2K": 0.134, "4K": 0.24 },
};
const OMNI_SECOND: Record<string, number> = { "360p": 0.023, "720p": 0.07, "1080p": 0.104 };

/** OpenAI's charge for what an answer used: $30 per million picture tokens out, $8 in, $5 of text in. */
export function openaiCost(u: { output_tokens?: number; input_tokens_details?: { image_tokens?: number; text_tokens?: number }; input_tokens?: number }): number {
  const img = u.input_tokens_details?.image_tokens ?? 0;
  const text = u.input_tokens_details?.text_tokens ?? Math.max(0, (u.input_tokens ?? 0) - img);
  return ((u.output_tokens ?? 0) * 30 + img * 8 + text * 5) / 1_000_000;
}

export interface GenAsk { kind: GenKind; provider: GenProvider; model: string; count?: number; aspect?: GenAspect; quality?: GenQuality; seconds?: number }

/** What a request will cost, in dollars, before it is made: a fair guess for OpenAI's newest, exact for the rest. */
export function estimateCost(a: GenAsk): number {
  const q = a.quality ?? "good";
  if (a.kind === "video") return (OMNI_SECOND[VIDEO_RESOLUTION[q]] ?? 0.07) * Math.max(3, Math.min(15, a.seconds ?? 6));
  const n = Math.max(1, Math.min(4, a.count ?? 1));
  if (a.provider === "openai") return n * OPENAI_EACH[OPENAI_QUALITY[q]][a.aspect === "1:1" || !a.aspect ? 0 : 1];
  return n * (GOOGLE_EACH[a.model]?.[GOOGLE_SIZE[q]] ?? GOOGLE_EACH["gemini-nano-banana-2.1"][GOOGLE_SIZE[q]]);
}

export const money = (n: number) => (n < 0.01 && n > 0 ? "under 1 cent" : `$${n.toFixed(2)}`);
