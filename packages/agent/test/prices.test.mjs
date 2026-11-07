// What an answer costs, from the tokens it used: the number a spending limit is held to.

import assert from "node:assert/strict";
import test from "node:test";
import { costOf, dollars, priceOf } from "../src/prices.mjs";

test("an answer costs its input, output and cache tokens at the model's prices", () => {
  // Sonnet 5.5: $2 in, $10 out, $0.20 a cached read, a cache write 1.25 times the input.
  const c = costOf("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: 400_000, cache_read_input_tokens: 2_000_000 });
  assert.equal(c.toFixed(4), (2 + 1 + 0.4 * 2 * 1.25 + 2 * 0.2).toFixed(4));
  assert.equal(costOf("claude-opus-5-5", { input_tokens: 1e6 }), 4);
  assert.equal(costOf("claude-fable-5-1", { output_tokens: 1e6 }), 50);
  assert.equal(costOf("claude-sonnet-5-5"), 0, "no usage, no cost");
});

test("Haiku 5.5 costs more once a prompt passes 100K tokens", () => {
  assert.equal(costOf("claude-haiku-5-5", { input_tokens: 100_000 }).toFixed(4), (0.1 * 0.1).toFixed(4));
  assert.equal(costOf("claude-haiku-5-5", { input_tokens: 60_000, cache_read_input_tokens: 60_000, output_tokens: 1000 }).toFixed(6), ((60_000 * 0.5 + 60_000 * 0.01 + 1000 * 2.5) / 1e6).toFixed(6));
});

test("a dated id is priced as its model, and a model it does not know as the dearest", () => {
  assert.equal(priceOf("claude-haiku-4-5-20251001").input, 1);
  assert.equal(priceOf("claude-haiku-4-5-20251001").known, true);
  const unknown = priceOf("claude-something-new");
  assert.equal(unknown.known, false);
  assert.equal(unknown.output, 50, "errs toward stopping early, never toward a surprise bill");
});

test("dollars read as a person reads them", () => {
  assert.equal(dollars(0), "$0");
  assert.equal(dollars(0.004), "under 1 cent");
  assert.equal(dollars(1.5), "$1.50");
  assert.equal(dollars(1234.4), "$1,234");
});
