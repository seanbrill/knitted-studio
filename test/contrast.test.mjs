import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/scan.mjs";
import { check, ratio } from "../scripts/check-contrast.mjs";

const css = readFileSync(join(ROOT, "packages/ui/src/globals.css"), "utf8");

test("the contrast formula matches published reference values", () => {
  assert.equal(ratio("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(ratio("#777777", "#ffffff").toFixed(2), "4.48"); // the classic just-fails grey
});

test("every pair the theme claims passes, in Day and Night", () => {
  const { problems } = check(css);
  assert.deepEqual(problems, []);
});

test("it can fail: muddying the orange text token is caught", () => {
  const bad = css.replace("--ember-ink: #a64009;", "--ember-ink: #ff9254;"); // light orange on white
  assert.ok(check(bad).problems.some((p) => p.includes("orange text")), "a failing Day pair was not reported");
});

test("it can fail: if white on ember ever passes, the rule is flagged as stale", () => {
  const bad = css.replace("--ember: #df5a0f;", "--ember: #8a2f00;");
  assert.ok(check(bad).problems.some((p) => p.includes("white on ember")));
});
