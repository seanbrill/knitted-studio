import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyDesignOps, designStarter, framePage, frameSize, lintDesignCode, tokensCss, yarnIn, DesignProblem, FALLBACK_SWATCH, LIBRARY_ID } from "../src/index.ts";
import { changeDesign, createDesign, deleteDesign, duplicateDesign, getDesign, listDesigns, openStore, restoreDesign, undoDesign } from "../src/node.ts";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-design-")), "k.db"));
const p = store.createProject({ name: "Northwind Coffee" });
const NOW = "2026-11-08T10:00:00.000Z";

test("a sheet from the brand starts with Foundations, Components and Pages, drawn only with the tokens", () => {
  const s = designStarter("brand", { brand: "Northwind <Coffee>", hasLogo: false, now: NOW });
  assert.deepEqual(s.map((x) => x.name), ["Foundations", "Components", "Pages"]);
  assert.deepEqual(s[2].frames.map((f) => [f.name, f.width]), [["Home", 1440], ["Home, mobile", 390]]);
  const all = s.flatMap((x) => x.frames);
  assert.ok(all.every((f) => !lintDesignCode(f.html, f.css).length), "the starter passes its own checks");
  assert.ok(all.every((f) => !/#[0-9a-f]{6}\b/i.test(f.css)), "no colour is written as a value: all follow the Swatch");
  assert.match(s[2].frames[0].html, /Northwind &lt;Coffee&gt;/, "the brand's name is escaped");
  assert.match(s[1].frames[2].html, /&copy; 2026/);
  assert.match(designStarter("brand", { brand: "B", hasLogo: true, now: NOW })[1].frames[0].html, /src="yarn:logo"/);
  assert.deepEqual(designStarter("blank", { brand: "B", hasLogo: false, now: NOW }).map((x) => [x.name, x.frames.length]), [["Pages", 0]]);
});

test("changes apply in order, all or none, and say what they made", () => {
  const base = { name: "Site", sections: designStarter("blank", { brand: "B", hasLogo: false, now: NOW }) };
  const r = applyDesignOps(base, [
    { op: "addSection", name: "Foundations", at: 0 },
    { op: "setFrame", section: "pages", name: "Home", width: 1440, html: "<h1>Hi</h1>", css: "h1{color:var(--color-primary)}" },
    { op: "setFrame", section: "Pages", name: "Home, mobile", width: 390, height: 844, html: "<h1>Hi</h1>", css: "" },
    { op: "rename", name: "  The   site " },
  ], "model", NOW);
  assert.equal(r.name, "The site");
  assert.deepEqual(r.sections.map((s) => s.id), ["s2", "s1"]);
  assert.deepEqual(r.made, { sections: ["s2"], frames: ["f1", "f2"] });
  assert.equal(r.sections[1].frames[1].height, 844);
  assert.equal(r.sections[1].frames[0].by, "model");
  assert.deepEqual(base.sections[0].frames, [], "the sheet given is left as it was");

  const moved = applyDesignOps(r, [{ op: "moveFrame", frameId: "f2", section: "s2" }, { op: "duplicateFrame", frameId: "f1" }, { op: "setFrame", section: "s1", frameId: "f1", height: null, html: "<h1>Hello</h1>" }], "human", NOW);
  assert.deepEqual(moved.sections.map((s) => s.frames.map((f) => f.name)), [["Home, mobile"], ["Home", "Home copy"]]);
  assert.equal(moved.sections[1].frames[0].html, "<h1>Hello</h1>");
  assert.equal(moved.sections[1].frames[0].css, "h1{color:var(--color-primary)}", "what is not given stays");
  assert.equal(moved.sections[1].frames[1].id, "f3");

  assert.throws(() => applyDesignOps(r, [{ op: "removeFrame", frameId: "f1" }, { op: "moveSection", section: "Nowhere", to: 0 }], "human"), (e) => e instanceof DesignProblem && /no section "Nowhere".*Foundations \(s2\)/.test(e.message));
  assert.throws(() => applyDesignOps(r, [{ op: "setFrame", section: "s1", name: "X", width: 100, html: "" }], "human"), /240 to 3840/);
  assert.throws(() => applyDesignOps(r, [{ op: "setFrame", section: "s1", name: "", html: "" }], "human"), /Give the frame a name/);
  assert.throws(() => applyDesignOps(r, [{ op: "setFrame", section: "s1", frameId: "f9", html: "" }], "human"), /no frame "f9"/);
  assert.throws(() => applyDesignOps(r, [{ op: "explode" }], "human"), /not a change/);
});

test("a frame's code may not run scripts or load from the web, and is told how to fix it", () => {
  const errs = (html, css = "") => lintDesignCode(html, css).filter((l) => l.level === "error").map((l) => l.message);
  assert.match(errs("<script>alert(1)</script>")[0], /Scripts do not run/);
  assert.match(errs('<button onclick="x()">Go</button>')[0], /Event handlers/);
  assert.match(errs('<img src="https://example.com/a.png" alt="">')[0], /yarn:<id>/);
  assert.match(errs("", ".hero{background:url(//cdn.example.com/a.jpg)}")[0], /url\(yarn:<id>\)/);
  assert.match(errs('<link rel="stylesheet" href="x.css">')[0], /not allowed/);
  assert.deepEqual(errs('<a href="https://northwind.coffee">Visit</a><form><input></form><img src="yarn:logo" alt="Logo">'), [], "links and forms are fine: they go nowhere here");
  assert.match(lintDesignCode('<img src="yarn:logo">', "").find((l) => l.level === "warning").message, /alt text/);
  assert.throws(() => applyDesignOps({ name: "S", sections: [{ id: "s1", name: "Pages", frames: [] }] }, [{ op: "setFrame", section: "s1", name: "X", html: "<script></script>" }], "model"), /Scripts do not run/);
});

test("a frame's page has the brand as CSS variables, its fonts, and its Yarn where the page can find it", () => {
  const css = tokensCss(FALLBACK_SWATCH);
  assert.match(css, /--color-primary:#df5a0f;/);
  assert.match(css, /--font-display:"Bricolage Grotesque",system-ui,sans-serif;/);
  assert.match(css, /--color-on-primary:#17110b;/, "readable text on the primary");
  assert.match(css, /--radius:13px;/);
  const sw = { ...FALLBACK_SWATCH, logos: [{ yarnId: "yn_LOGO0000000000000000", use: "full" }] };
  const f = { name: "Home <1>", width: 390, height: 844, html: '<img src="yarn:logo" alt=""><img src="yarn:yn_AAAAAAAAAAAAAAAAAAAA" alt=""><div style="background:url(yarn:yn_BBBBBBBBBBBBBBBBBBBB)"></div>', css: ".x{background:url(yarn:yn_AAAAAAAAAAAAAAAAAAAA)}" };
  assert.deepEqual(yarnIn(f.html, f.css), ["logo", "yn_AAAAAAAAAAAAAAAAAAAA", "yn_BBBBBBBBBBBBBBBBBBBB"]);
  const page = framePage(f, { swatch: sw, fontsHref: "/api/projects/pj_1/fonts.css", yarnUrl: (id) => (id === "yn_BBBBBBBBBBBBBBBBBBBB" ? undefined : `/files/${id}`) });
  assert.match(page, /<title>Home &lt;1&gt;<\/title>/);
  assert.match(page, /<meta name="viewport" content="width=390">/);
  assert.match(page, /html,body\{margin:0;padding:0;width:390px;height:844px\}/);
  assert.match(page, /src="\/files\/yn_LOGO0000000000000000"/);
  assert.match(page, /url\(\/files\/yn_AAAAAAAAAAAAAAAAAAAA\)/);
  assert.match(page, /url\(data:image\/svg\+xml,/, "a file no longer in Yarn shows a placeholder");
  assert.match(page, /animation:none!important/, "a design is a still");
  assert.equal(frameSize({ width: 390, height: 844 }), "Mobile 390 x 844");
  assert.equal(frameSize({ width: 1200 }), "1200 wide");
});

test("the store keeps each version, so Undo walks back through changes, and a deleted sheet comes back", () => {
  assert.throws(() => createDesign(store, LIBRARY_ID, { name: "X" }), /belongs to a project/);
  const d = createDesign(store, p.id, { name: "Website" });
  assert.equal(d.sections.length, 3);
  assert.equal(d.canUndo, false);
  assert.deepEqual(store.activity(p.id, 1).map((a) => [a.action, a.subject]), [["design.created", "Website"]]);

  const one = changeDesign(store, d.id, [{ op: "setFrame", section: "Pages", frameId: "f7", html: "<h1>Northwind</h1>" }], "model");
  assert.equal(one.version, 2);
  assert.equal(one.sections[2].frames[0].by, "model");
  const two = changeDesign(store, d.id, [{ op: "addSection", name: "Shop" }], "human");
  assert.deepEqual(two.made.sections, ["s4"]);
  assert.throws(() => changeDesign(store, d.id, [{ op: "removeSection", section: "s9" }]), (e) => e.kind === "validation");
  assert.equal(getDesign(store, d.id).version, 3, "a refused change is no version");

  assert.equal(undoDesign(store, d.id).sections.length, 3);
  const back = undoDesign(store, d.id);
  assert.notEqual(back.sections[2].frames[0].html, "<h1>Northwind</h1>");
  assert.equal(back.canUndo, false);
  assert.throws(() => undoDesign(store, d.id), /nothing to undo/);

  const copy = duplicateDesign(store, d.id);
  assert.equal(copy.name, "Website copy");
  assert.deepEqual(listDesigns(store, p.id).map((x) => x.id).sort(), [d.id, copy.id].sort());
  deleteDesign(store, copy.id);
  assert.deepEqual(listDesigns(store, p.id).map((x) => x.id), [d.id]);
  assert.throws(() => changeDesign(store, copy.id, [{ op: "rename", name: "Y" }]), /deleted/);
  assert.equal(restoreDesign(store, copy.id).deletedAt, null);
  assert.equal(listDesigns(store, p.id).length, 2);
});

// ── the board as a canvas (design sheet f49) ──
import { BOARD, dropIndex, frameRev, guessHeight, layoutDesign, snapToGrid } from "../src/index.ts";
import { codeHash, compactDesignVersions, designVersion, getDesignMeta, getFrameCode, setFrameHeights } from "../src/node.ts";

const fr = (id, width, height) => ({ id, width, ...(height ? { height } : {}) });

test("sections not placed stand in a column, in order, with their frames in a row", () => {
  const lay = layoutDesign([
    { id: "s1", frames: [fr("f1", 1440, 900), fr("f2", 390, 844)] },
    { id: "s2", frames: [] },
    { id: "s3", frames: [fr("f3", 1440)] },
  ]);
  const [a, b, c] = lay.sections;
  assert.deepEqual([a.x, a.y, a.w, a.h], [0, 0, BOARD.pad * 2 + 1440 + BOARD.gap + 390, BOARD.pad * 2 + 900]);
  assert.deepEqual(a.frames.map((f) => [f.id, f.x, f.y]), [["f1", BOARD.pad, BOARD.pad], ["f2", BOARD.pad + 1440 + BOARD.gap, BOARD.pad]]);
  assert.deepEqual([b.x, b.y, b.w, b.h], [0, a.h + BOARD.stack, BOARD.emptyW, BOARD.emptyH], "an empty section has room to add a frame");
  assert.equal(c.y, b.y + b.h + BOARD.stack);
  assert.equal(c.frames[0].h, guessHeight({ width: 1440 }), "a frame not measured yet is a guess");
  assert.deepEqual([lay.x, lay.y, lay.w, lay.h], [0, 0, a.w, c.y + c.h]);
  assert.equal(layoutDesign([{ id: "s1", frames: [fr("f1", 1440)] }], () => 2400).sections[0].frames[0].h, 2400, "a measured height is used");
});

test("a placed section is where it was put, and the column stands under the placed ones", () => {
  const lay = layoutDesign([
    { id: "s1", frames: [fr("f1", 400, 300)] },
    { id: "s2", x: -800, y: 400, frames: [fr("f2", 400, 300)] },
    { id: "s3", x: 2000, y: -200, frames: [fr("f3", 400, 1000)] },
  ]);
  const [a, b, c] = lay.sections;
  assert.deepEqual([b.x, b.y, b.placed], [-800, 400, true]);
  assert.deepEqual([c.x, c.y, c.placed], [2000, -200, true]);
  assert.deepEqual([a.x, a.y, a.placed], [0, Math.max(400 + b.h, -200 + c.h) + BOARD.stack, false]);
  assert.deepEqual([b.frames[0].x, b.frames[0].y], [-800 + BOARD.pad, 400 + BOARD.pad], "frames go with their section");
  assert.deepEqual([lay.x, lay.y], [-800, -200], "the board starts at its top left section");
  assert.equal(lay.w, 2000 + c.w + 800);
});

test("placed sections never overlap: one that would goes under it, and the one being moved stays where it is put", () => {
  const sec = (id, x, y, h) => ({ id, x, y, frames: [fr(`${id}f`, 400, h - 2 * BOARD.pad)] });
  // s1 grew (wrapped, or more frames) down over s2, which was put 100 under where s1 ended.
  const lay = layoutDesign([sec("s1", 0, 0, 2000), sec("s2", 0, 1100, 500), sec("s3", 0, 1700, 500), sec("s4", 2000, 1100, 500)]);
  const [a, b, c, d] = lay.sections;
  assert.deepEqual([a.y, b.y], [0, 2000 + BOARD.stack], "pushed under the one that grew");
  assert.equal(c.y, b.y + 500 + BOARD.stack, "and the next one with it");
  assert.equal(d.y, 1100, "one beside it stays");
  assert.equal(b.frames[0].y, b.y + BOARD.pad, "frames go with their section");
  // Put down over s1, s3 stays where it was put, and s1 makes room.
  const put = layoutDesign([sec("s1", 0, 0, 2000), sec("s3", 200, 400, 500)], undefined, { first: "s3" });
  assert.deepEqual([put.sections[1].y, put.sections[0].y], [400, 400 + 500 + BOARD.stack]);
  // Still being dragged, it floats over s1, which stays.
  const dragged = layoutDesign([sec("s1", 0, 0, 2000), sec("s3", 200, 400, 500)], undefined, { float: "s3" });
  assert.deepEqual([dragged.sections[1].y, dragged.sections[0].y], [400, 0]);
  // Touching is not overlapping.
  assert.equal(layoutDesign([sec("s1", 0, 0, 500), sec("s2", 0, 500, 500)]).sections[1].y, 500);
});

test("a section's width wraps its frames into rows, never narrower than its widest frame", () => {
  const frames = [fr("f1", 1440, 900), fr("f2", 390, 844), fr("f3", 1440, 600), fr("f4", 390, 844)];
  const lay = layoutDesign([{ id: "s1", width: 1440 + 390 + BOARD.gap + 2 * BOARD.pad, frames }]);
  const [s] = lay.sections;
  assert.deepEqual(s.frames.map((f) => [f.id, f.x, f.y]), [
    ["f1", BOARD.pad, BOARD.pad], ["f2", BOARD.pad + 1440 + BOARD.gap, BOARD.pad],
    ["f3", BOARD.pad, BOARD.pad + 900 + BOARD.rowGap], ["f4", BOARD.pad + 1440 + BOARD.gap, BOARD.pad + 900 + BOARD.rowGap],
  ]);
  assert.equal(s.h, 2 * BOARD.pad + 900 + BOARD.rowGap + 844);
  const narrow = layoutDesign([{ id: "s1", width: 500, frames }]).sections[0];
  assert.equal(narrow.w, 1440 + 2 * BOARD.pad, "as wide as its widest frame");
  assert.deepEqual(narrow.frames.map((f) => f.x), [BOARD.pad, BOARD.pad, BOARD.pad, BOARD.pad], "one frame a row");
});

test("a frame dropped in a section goes in the gap nearest the point, in the row nearest it", () => {
  const lay = layoutDesign([{ id: "s1", width: 2 * 400 + BOARD.gap + 2 * BOARD.pad, frames: [fr("f1", 400, 300), fr("f2", 400, 300), fr("f3", 400, 300)] }]);
  const s = lay.sections[0];
  const [f1, f2, f3] = s.frames;
  assert.equal(dropIndex(s, null, f1.x + 10, f1.y + 10), 0);
  assert.equal(dropIndex(s, null, f1.x + 300, f1.y + 10), 1);
  assert.equal(dropIndex(s, null, f2.x + 300, f2.y + 10), 2, "after the last in its row");
  assert.equal(dropIndex(s, null, f3.x + 300, f3.y + 100), 3, "after the last of all");
  assert.equal(dropIndex(s, "f1", f3.x + 10, f3.y + 10), 1, "the moved frame does not count: before f3, among the others");
  assert.equal(dropIndex(layoutDesign([{ id: "s2", frames: [] }]).sections[0], "f1", 0, 0), 0);
  // Wrapped to one frame a row, a frame let go where it was, straight above or below, stays there.
  const col = layoutDesign([{ id: "s3", width: 500, frames: [fr("a", 400, 1000), fr("b", 400, 1000), fr("c", 400, 1000)] }]).sections[0];
  const [, b, c] = col.frames;
  for (const dx of [-1, 0, 1]) assert.equal(dropIndex(col, "b", b.x + b.w / 2 + dx, b.y + 100), 1, `dropped on its own place, ${dx} from the middle`);
  assert.equal(dropIndex(col, "b", b.x + 100, c.y + c.h - 10), 2, "low on the next one: after it");
  assert.equal(dropIndex(col, "c", c.x + 10, col.frames[0].y + 10), 0, "high on the first: before it");
  assert.equal(snapToGrid(57), 40);
  assert.equal(snapToGrid(-61), -80);
});

test("sections are placed, wrapped and put back in the column; a sheet takes as many frames as it is given", () => {
  const base = { name: "S", sections: [{ id: "s1", name: "Pages", frames: [] }] };
  const placed = applyDesignOps(base, [{ op: "placeSection", section: "Pages", x: 120.4, y: -80 }, { op: "updateSection", section: "s1", width: 3000 }, { op: "addSection", name: "Shop", x: 2000, y: 0, width: 1200 }], "human");
  assert.deepEqual([placed.sections[0].x, placed.sections[0].y, placed.sections[0].width], [120, -80, 3000]);
  assert.deepEqual([placed.sections[1].x, placed.sections[1].y, placed.sections[1].width], [2000, 0, 1200]);
  const back = applyDesignOps(placed, [{ op: "placeSection", section: "s1", x: null, y: null }, { op: "updateSection", section: "s1", width: null }], "human");
  assert.deepEqual(Object.keys(back.sections[0]).sort(), ["frames", "id", "name"]);
  assert.throws(() => applyDesignOps(base, [{ op: "placeSection", section: "s1", x: "left", y: 0 }], "human"), /x on the board/);
  assert.throws(() => applyDesignOps(base, [{ op: "placeSection", section: "s1", x: 0, y: 5e7 }], "human"), /y on the board/);
  assert.throws(() => applyDesignOps(base, [{ op: "updateSection", section: "s1", width: 100 }], "human"), /400 to 100,000/);
  const many = applyDesignOps(base, [
    ...Array.from({ length: 60 }, (_, i) => ({ op: "addSection", name: `Part ${i}` })),
    ...Array.from({ length: 260 }, (_, i) => ({ op: "setFrame", section: "s1", name: `Frame ${i}`, html: `<p>${i}</p>` })),
  ], "model");
  assert.equal(many.sections.length, 61, "past the 40 sections a sheet once had");
  assert.equal(many.sections[0].frames.length, 260, "and past the 200 frames");
  assert.equal(applyDesignOps(many, [{ op: "duplicateFrame", frameId: "f260" }], "human").sections[0].frames.length, 261);
});

test("Undo keeps each frame's code once, not a copy of the sheet a change, and brings each version back exactly", () => {
  const d = createDesign(store, p.id, { name: "Kept once" });
  const before = getDesign(store, d.id);
  for (let i = 1; i <= 6; i++) changeDesign(store, d.id, [{ op: "setFrame", section: "Pages", frameId: "f7", html: `<h1>Version ${i}</h1>` }], "model");
  const rows = store.db.prepare("select count(*) n from design_code where design_id = ?").get(d.id).n;
  const frames = before.sections.flatMap((s) => s.frames);
  const distinct = new Set(frames.map((f) => codeHash(f.html, f.css))).size;
  assert.equal(rows, distinct + 5, "the starting frames once, and each earlier Home once");
  for (const r of store.db.prepare("select data from design_versions where design_id = ?").all(d.id)) {
    assert.match(r.data, /^\{"refs":1,/);
    assert.doesNotMatch(r.data, /"html"/, "no code in a kept version");
  }
  for (let i = 5; i >= 1; i--) assert.equal(undoDesign(store, d.id).sections[2].frames[0].html, `<h1>Version ${i}</h1>`);
  assert.deepEqual(undoDesign(store, d.id).sections, before.sections, "the sheet as it started, to the letter");
});

test("versions kept as whole copies are kept the lighter way when the library opens, and still undo", () => {
  const d = createDesign(store, p.id, { name: "Old versions" });
  const first = getDesign(store, d.id);
  // As 0.1.48 kept them: the whole sheet, code and all.
  store.db.prepare("insert into design_versions (design_id, version, name, data, actor, at) values (?, ?, ?, ?, ?, ?)").run(d.id, 1, first.name, JSON.stringify({ sections: first.sections }), "human", NOW);
  store.db.prepare("update designs set version = 2, data = ? where id = ?").run(JSON.stringify({ sections: [{ id: "s1", name: "Gone", frames: [] }] }), d.id);
  assert.ok(compactDesignVersions(store) >= 1);
  assert.match(store.db.prepare("select data from design_versions where design_id = ?").get(d.id).data, /^\{"refs":1,/);
  assert.equal(compactDesignVersions(store), 0, "once");
  assert.deepEqual(undoDesign(store, d.id).sections, first.sections);
});

test("the board's sheet has no code: each frame's names it, and how tall it was drawn while that is still so", () => {
  const d = createDesign(store, p.id, { name: "Light" });
  const full = getDesign(store, d.id);
  const meta = getDesignMeta(store, d.id);
  const home = meta.sections[2].frames[0];
  assert.equal(home.html, undefined);
  assert.equal(home.code, codeHash(full.sections[2].frames[0].html, full.sections[2].frames[0].css));
  assert.equal(home.chars, full.sections[2].frames[0].html.length + full.sections[2].frames[0].css.length);
  assert.ok(JSON.stringify(meta).length * 3 < JSON.stringify(full).length, "a small part of the whole");
  assert.equal(designVersion(store, d.id), 1);
  assert.deepEqual(Object.keys(getFrameCode(store, d.id, ["f7", "f99"])), ["f7"]);
  assert.equal(getFrameCode(store, d.id, ["f7"]).f7.html, full.sections[2].frames[0].html);

  assert.equal(setFrameHeights(store, d.id, { f7: { rev: frameRev(home), height: 2210 }, f99: { rev: "x", height: 5 }, f8: { rev: "x", height: -1 } }), 1, "only frames on the sheet, at a height a frame can be");
  assert.equal(getDesignMeta(store, d.id).sections[2].frames[0].measured, 2210);
  setFrameHeights(store, d.id, { f8: { rev: "not as it is", height: 900 } });
  assert.equal(getDesignMeta(store, d.id).sections[2].frames[1].measured, undefined, "measured as it was not");
  changeDesign(store, d.id, [{ op: "setFrame", section: "Pages", frameId: "f7", html: "<h1>New</h1>" }]);
  assert.equal(getDesignMeta(store, d.id).sections[2].frames[0].measured, undefined, "changed since it was measured");
  changeDesign(store, d.id, [{ op: "setFrame", section: "Pages", frameId: "f7", height: 900 }]);
  setFrameHeights(store, d.id, { f7: { rev: frameRev(getDesignMeta(store, d.id).sections[2].frames[0]), height: 1200 } });
  assert.equal(getDesignMeta(store, d.id).sections[2].frames[0].measured, undefined, "a fixed height needs no measuring");
});

test("a pattern, a Yarn picture or a part goes on a sheet as itself: named and sized from it as it is now, and drawn again when it changes", async () => {
  const { importYarn, listParts } = await import("../src/node.ts");
  const post = store.createPattern(p.id, { name: "Launch post", size: { name: "Instagram post", w: 1080, h: 1350 } });
  const d = createDesign(store, p.id, { name: "Campaign", start: "blank" });
  const r = changeDesign(store, d.id, [{ op: "addSection", name: "Social" }, { op: "addPiece", section: "Social", kind: "pattern", id: post.id }]);
  const f = r.sections[1].frames[0];
  assert.deepEqual([f.name, f.width, f.height, f.html, f.css, f.piece], ["Launch post", 1080, 1350, "", "", { kind: "pattern", id: post.id }], "as big as it is, with no code");
  assert.deepEqual(r.made.frames, [f.id]);
  const meta = () => getDesignMeta(store, d.id).sections[1].frames[0];
  const before = meta();
  assert.deepEqual(before.piece, { kind: "pattern", id: post.id, w: 1080, h: 1350 });
  assert.equal(frameSize(before), "Pattern 1080 x 1350");

  // Changed anywhere, the sheet has its new name and shape, and a new name for its picture; and
  // a board that has the sheet at this version is told its pieces look different now.
  const { piecesKey } = await import("../src/node.ts");
  const key = piecesKey(store, d.id);
  assert.equal(getDesignMeta(store, d.id).pieces, key);
  assert.equal(piecesKey(store, createDesign(store, p.id, { name: "No pieces", start: "blank" }).id), "", "nothing to ask about without pieces");
  store.apply(post.id, { type: "setMeta", name: "Spring launch" }, "human");
  assert.notEqual(piecesKey(store, d.id), key);
  assert.equal(meta().name, "Spring launch");
  assert.notEqual(meta().code, before.code, "drawn again");
  store.apply(post.id, { type: "setSize", size: { name: "Story", w: 1080, h: 1920 } }, "human");
  assert.deepEqual([meta().height, meta().piece.h], [1920, 1920]);

  // Drawn narrower, it keeps its shape. It has no code to change: the pattern is changed instead.
  changeDesign(store, d.id, [{ op: "setFrame", section: "Social", frameId: f.id, width: 540 }]);
  assert.deepEqual([meta().width, meta().height], [540, 960]);
  assert.throws(() => changeDesign(store, d.id, [{ op: "setFrame", section: "Social", frameId: f.id, html: "<h1>x</h1>" }]), /placed on the sheet, not code: change the pattern itself/);
  changeDesign(store, d.id, [{ op: "setFrame", section: "Social", frameId: f.id, note: "For the launch week" }]);
  assert.equal(meta().note, "For the launch week");

  // Only the project's own things, and only pictures and videos from Yarn.
  const other = store.createProject({ name: "Elsewhere", starter: "blank" });
  const theirs = store.createPattern(other.id, { name: "Not ours" });
  assert.throws(() => changeDesign(store, d.id, [{ op: "addPiece", section: "Social", kind: "pattern", id: theirs.id }]), /no pattern .* in this project/);
  assert.throws(() => changeDesign(store, d.id, [{ op: "addPiece", section: "Social", kind: "yarn", id: "yn_nope" }]), /no picture or video/);
  assert.throws(() => changeDesign(store, d.id, [{ op: "addPiece", section: "Social", kind: "knit", id: "x" }]), /pattern, yarn or a part/);

  const dir = mkdtempSync(join(tmpdir(), "knitted-piece-"));
  const { default: sharp } = await import("sharp");
  await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#3366cc" } }).png().toFile(join(dir, "hero.png"));
  const hero = (await importYarn(store, p.id, join(dir, "hero.png"), "hero.png")).yarn;
  const part = listParts(store, p.id)[0];
  const r2 = changeDesign(store, d.id, [{ op: "addPiece", section: "Social", kind: "yarn", id: hero.id }, { op: "addPiece", section: "Social", kind: "part", id: part.id, width: 500 }]);
  const [, pic, bit] = r2.sections[1].frames;
  assert.deepEqual([pic.name, pic.width, pic.height], ["hero", 1440, 960], "a big picture no wider than a desktop screen");
  assert.deepEqual([bit.name, bit.width, bit.height], [part.name, 500, Math.round(500 / part.aspect)]);

  // Gone from the project, it keeps its place, its last name and its size, and says it has gone.
  store.deletePattern(post.id);
  const gone = meta();
  assert.deepEqual([gone.name, gone.width, gone.height, gone.piece.gone], ["Spring launch", 540, 960, true], "as it was at the sheet's last change");
  assert.equal(getDesign(store, d.id).sections[1].frames.length, 3, "still on the sheet");
});

test("a pattern on a sheet can be shown at another of its sizes, laid out there, while the pattern keeps its own", async () => {
  const { listParts } = await import("../src/node.ts");
  const post = store.createPattern(p.id, { name: "Sale post", size: { name: "Post", w: 1080, h: 1350 } });
  const d = createDesign(store, p.id, { name: "Sizes", start: "blank" });
  const s = d.sections[0].id;
  // Added at a size: that shape, from the start.
  const r = changeDesign(store, d.id, [{ op: "addPiece", section: s, kind: "pattern", id: post.id, size: "story" }]);
  const f = r.sections[0].frames[0];
  assert.deepEqual([f.width, f.height, f.piece], [1080, 1920, { kind: "pattern", id: post.id, size: "Story" }], "named as SIZES names it");
  const meta = () => getDesignMeta(store, d.id).sections[0].frames[0];
  assert.deepEqual([meta().piece.w, meta().piece.h, frameSize(meta())], [1080, 1920, "Pattern 1080 x 1920"]);
  const story = meta().code;

  // Switched: as tall as that shape at its width, drawn again; and back to its own.
  changeDesign(store, d.id, [{ op: "setFrame", section: s, frameId: f.id, width: 540 }, { op: "setFrame", section: s, frameId: f.id, size: "Square" }]);
  assert.deepEqual([meta().width, meta().height, meta().piece.size, meta().piece.h], [540, 540, "Square", 1080]);
  assert.notEqual(meta().code, story, "drawn again at the new size");
  changeDesign(store, d.id, [{ op: "setFrame", section: s, frameId: f.id, size: null }]);
  assert.deepEqual([meta().height, meta().piece.size, meta().piece.h], [675, undefined, 1350]);
  assert.equal(getDesign(store, d.id).sections[0].frames[0].height, 675, "kept at its own shape, not the last size's");
  assert.deepEqual(store.getPattern(post.id).size, { name: "Post", w: 1080, h: 1350 }, "the pattern itself is unchanged");

  // Only a pattern has sizes, and only the ones it knits at.
  assert.throws(() => changeDesign(store, d.id, [{ op: "setFrame", section: s, frameId: f.id, size: "Poster" }]), /its own size or one of: Story, Post, Square, Landscape, Banner/);
  const part = listParts(store, p.id)[0];
  assert.throws(() => changeDesign(store, d.id, [{ op: "addPiece", section: s, kind: "part", id: part.id, size: "Story" }]), /Only a pattern can be shown at another size/);
});
