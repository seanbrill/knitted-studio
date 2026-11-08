// Auto: the model for each task, picked so a task costs no more than it needs.
//
// A message starts on the least model that fits what it asks: Haiku for a quick edit or a
// question, Opus for layout, a design sheet or motion, Sonnet for the rest. While the task runs it
// may step up, when steps keep failing or the task turns out longer than that model is for, and
// it never steps down part way: Sonnet 5.5 reads Haiku 5.5's thinking, and Opus 5.5 reads both,
// so stepping up keeps what the model worked out so far, where stepping down would lose it.
//
// Between messages it may step down, unless the chat is long and was just answered: the
// conversation is then in the model's cache, and reading it again on another model would cost
// more than the other model saves.

import { priceOf } from "./prices.mjs";

export const AUTO = "auto";
/** From the least to the most a task may need. Fable is only ever chosen by the person. */
export const LADDER = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
export const SHORT_NAMES = {
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-fable-5-1": "Claude Fable 5.1",
};
export const nameOf = (model) => SHORT_NAMES[model] ?? String(model);

// Work that is mostly about how things look, or that makes a lot at once.
const BIG = /\b(design(s|ed|ing)?|redesign|lay ?out|layouts?|from scratch|new pattern|whole (site|sheet|page)|landing page|web ?site|home ?page|animat\w*|motion|video|reel|storyboard|campaign|series|every pattern|all (the |of the )?patterns|brand ?kit|swatch)\b/i;
// Work a quick model does as well: changing words, naming and filing things, answering.
const SMALL = /\b(rename|shorter|longer|typo|spelling|reword|rephrase|capitali[sz]e|translate|change (the )?(text|headline|title|copy|wording|words?|caption|date|price|name)|make (it|the \w+) say|say[s]? \w+ instead|tag|untag|move .* (in)?to|folder|list|what|which|how many|where|is there|are there|delete|remove|hide|show)\b/i;
const QUICK_LEN = 200;
const LONG_LEN = 900;

// A context worth keeping in its cache, and how long the cache lasts (Anthropic's five minutes,
// less a margin). A run is guessed at a few steps and a few thousand tokens written.
const WARM_MS = 4.5 * 60_000;
const GUESS_STEPS = 4;
const GUESS_OUT = 3000;

// While a task runs: this many failed steps on one model and it goes up a step, or this many
// steps, as the task is bigger than that model is for.
export const FAILS_UP = 2;
export const STEPS_UP = { "claude-haiku-5-5": 8, "claude-sonnet-5-5": 16 };

const rung = (model) => LADDER.indexOf(model);

// What an Ask dialog says before the person's own words: what the thing is (AskModel.tsx).
const WANT = "What I want: ";
// Of those, the ones about design: a sheet, a frame on one, or drawing.
const DESIGNING = /\b(design sheet|as SVG)\b/;

/** The least model a message needs, by what it asks, and why. */
export function fits(prompt) {
  const p = String(prompt ?? "");
  const at = p.lastIndexOf(WANT);
  const want = at >= 0 ? p.slice(at + WANT.length) : p;
  if ((at >= 0 && DESIGNING.test(p.slice(0, at))) || BIG.test(want) || want.length > LONG_LEN) return { model: LADDER[2], why: "picked for layout and design" };
  if (want.length <= QUICK_LEN && SMALL.test(want)) return { model: LADDER[0], why: "picked for a quick change" };
  return { model: LADDER[1], why: "picked as a good fit for this" };
}

/** What a run on `model` is guessed to cost, with `context` tokens already said and the cache warm or not. */
function guess(model, context, warm) {
  const p = priceOf(model);
  const first = warm ? context * p.read : context * p.input * 1.25;
  return (first + context * p.read * (GUESS_STEPS - 1) + GUESS_OUT * p.output) / 1e6;
}

/**
 * The model for a new message in Auto.
 * @param {{ prompt: string, last?: { model: string, context: number, at: number } | null, now?: number }} a
 *   `last`: the chat's last run, its model, how many tokens its last request held, and when it ended.
 */
export function pickModel({ prompt, last = null, now = Date.now() }) {
  const want = fits(prompt);
  if (!last || rung(last.model) < 0 || rung(last.model) <= rung(want.model) || !(last.context > 0)) return want;
  // It needs less than the chat was on. Stepping down is cheaper unless the chat is in the cache.
  const warm = now - last.at < WARM_MS;
  if (warm && guess(last.model, last.context, true) <= guess(want.model, last.context, false)) {
    return { model: last.model, why: "kept, as this long chat is in its cache, and another model would cost more to read it all again" };
  }
  return want;
}

/**
 * Part way through a task in Auto: the next model up, and why, or null to stay.
 * @param {string} model
 * @param {{ failed: number, steps: number }} since  failed steps and steps since it came onto this model
 */
export function stepUp(model, { failed, steps }) {
  const i = rung(model);
  if (i < 0 || i >= LADDER.length - 1) return null;
  const next = LADDER[i + 1];
  if (failed >= FAILS_UP) return { model: next, why: `${failed} steps failed on ${nameOf(model)}` };
  if (steps >= (STEPS_UP[model] ?? Infinity)) return { model: next, why: `the task is bigger than ${nameOf(model)} is for` };
  return null;
}

/** A model to send for a task of one request (a post, a profile): Auto is the good default there. */
export const concrete = (model, fallback) => (!model || model === AUTO ? fallback : model);
