// What a request to Claude costs, from the tokens its answer says it used. Dollars per million
// tokens, as Anthropic lists them. A cache write costs 1.25 times the input price (the five
// minute cache the agent uses); a cache read is the model's own read price.
//
// A model knitted does not know is priced as the most expensive one it does, so a limit
// errs toward stopping early, never toward a surprise bill.

/** @type {Record<string, { input: number, output: number, read: number, over?: { at: number, input: number, output: number } }>} */
export const PRICES = {
  "claude-fable-5-1": { input: 10, output: 50, read: 0.25 },
  "claude-mythos-5-1": { input: 10, output: 50, read: 0.25 },
  "claude-fable-5": { input: 10, output: 50, read: 1 },
  "claude-mythos-5": { input: 10, output: 50, read: 1 },
  "claude-opus-5-5": { input: 4, output: 20, read: 0.2 },
  "claude-opus-5": { input: 5, output: 25, read: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, read: 0.5 },
  "claude-opus-4-7": { input: 5, output: 25, read: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, read: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, read: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, read: 0.2 },
  "claude-sonnet-4-6": { input: 3, output: 15, read: 0.3 },
  // Haiku 5.5 costs more once a prompt passes 100K tokens.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, read: 0.01, over: { at: 100_000, input: 0.5, output: 2.5 } },
  "claude-haiku-4-5": { input: 1, output: 5, read: 0.1 },
};
const DEAREST = PRICES["claude-fable-5-1"];
const WRITE = 1.25;

/** The prices for a model, by its id or a dated id that starts with one (claude-haiku-4-5-20251001). */
export function priceOf(model) {
  const id = String(model ?? "");
  if (PRICES[id]) return { ...PRICES[id], known: true };
  const near = Object.keys(PRICES).sort((a, b) => b.length - a.length).find((k) => id.startsWith(`${k}-`));
  return near ? { ...PRICES[near], known: true } : { ...DEAREST, known: false };
}

/**
 * What one answer cost, in dollars, from its `usage` as the API sends it.
 * @param {string} model
 * @param {{ input_tokens?: number, output_tokens?: number, cache_creation_input_tokens?: number, cache_read_input_tokens?: number }} usage
 */
export function costOf(model, usage = {}) {
  const p = priceOf(model);
  const input = usage.input_tokens ?? 0, output = usage.output_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0, read = usage.cache_read_input_tokens ?? 0;
  const big = p.over && input + write + read > p.over.at;
  const inPrice = big ? p.over.input : p.input, outPrice = big ? p.over.output : p.output;
  return (input * inPrice + write * inPrice * WRITE + read * p.read + output * outPrice) / 1e6;
}

/** Dollars as a person reads them: cents for small amounts, never "$0.00" for something that cost a little. */
export function dollars(n) {
  if (!(n > 0)) return "$0";
  if (n < 0.01) return "under 1 cent";
  return `$${n < 100 ? n.toFixed(2) : Math.round(n).toLocaleString("en-US")}`;
}
