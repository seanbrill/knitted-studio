// What a voice should not say: real reels read "sites live my-site 3", the command typed on
// screen, and the person asked for the voice to say what it does instead.
import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_SWATCH, codeOnScreen, preflight, spokenProblem } from "../src/index.ts";

const reel = (voice) => ({
  id: "pt", projectId: "pj", name: "Friday 4:59", size: { name: "Story", w: 1080, h: 1920 }, version: 1, durationMs: 9000,
  stitches: [
    { id: "st_cmd", kind: "text", slot: "cmd", x: 0.1, y: 0.4, w: 0.8, h: 0.1, locked: false, content: "$ filefreak sites live my-site 3", style: { fontFamily: "$font.mono" } },
    { id: "st_head", kind: "text", slot: "headline", x: 0.1, y: 0.2, w: 0.8, h: 0.1, locked: false, content: "Don't cancel the weekend.", style: {} },
  ],
  motion: { tracks: {}, audio: voice.map((label, i) => ({ id: `au_${i}`, yarnId: `yr_${i}`, startMs: i * 2000, kind: "voice", label })) },
});
const yarn = Object.fromEntries([0, 1, 2].map((i) => [`yr_${i}`, { id: `yr_${i}`, kind: "audio", deletedAt: null }]));

test("a voice line that reads out the command on screen is flagged; saying what it does is not", () => {
  const shown = codeOnScreen(reel([]));
  assert.deepEqual(shown, ["$ filefreak sites live my-site 3"], "the monospace text is the code on screen; the headline is not");
  assert.match(spokenProblem("sites live my-site 3", shown), /reads out "sites live my-site" from the command typed on screen/);
  assert.equal(spokenProblem("Roll it back fast, right from the terminal.", shown), null);
  assert.equal(spokenProblem("Don't cancel the weekend.", shown), null, "words the screen shows as a headline may be said");
});

test("code-shaped words are flagged wherever they come from", () => {
  for (const line of ["Run it with --force.", "Open ~/Sites/notch in the terminal.", "Edit config.yml and save.", "Set max_upload_size first.", "Call getUserFiles to list them."]) {
    assert.match(spokenProblem(line) ?? "", /which is code/, line);
  }
  for (const line of ["Friday. Four fifty-nine. You deployed.", "Nine ninety-nine a month.", "Share it with one link, and stop it when you like.", "It works on desktop and phone."]) {
    assert.equal(spokenProblem(line), null, line);
  }
});

test("check_pattern warns about a voice that reads code, once a line", () => {
  const issues = preflight(reel(["Friday. Four fifty-nine. You deployed.", "sites live my-site 3", "Live again within a minute."]), FALLBACK_SWATCH, { yarn });
  const said = issues.filter((i) => i.code === "voice-reads-code");
  assert.equal(said.length, 1);
  assert.match(said[0].message, /Nobody can follow a command by ear/);
});
