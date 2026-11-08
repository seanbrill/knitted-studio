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
