import assert from "node:assert/strict";
import test from "node:test";
import { angleTo, bounds, center, corners, resizeBox, rotatePt, snapMove, toFrac, toPx, union, handleSign } from "../src/geometry.ts";

function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

test("a rotated box has the right corners and bounds", () => {
  const b = { x: 0, y: 0, w: 100, h: 50, rotate: 90 };
  const bb = bounds(b);
  near(bb.w, 50); near(bb.h, 100);
  near(center(bb).x, 50); near(center(bb).y, 25);
  assert.equal(corners(b).length, 4);
});

test("rotatePt about a point and back is the identity", () => {
  const p = rotatePt(rotatePt({ x: 13, y: -7 }, 37, { x: 5, y: 5 }), -37, { x: 5, y: 5 });
  near(p.x, 13); near(p.y, -7);
});

test("PROPERTY: the edge opposite the dragged handle never moves, at any rotation", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed);
    const box = { x: r() * 800, y: r() * 800, w: 40 + r() * 400, h: 40 + r() * 400, rotate: r() * 360 - 180 };
    const handle = HANDLES[Math.floor(r() * 8)];
    const dx = r() * 80 - 40, dy = r() * 80 - 40;
    const [sx, sy] = handleSign(handle);
    const anchorLocal = (b) => ({ x: -sx * b.w / 2, y: -sy * b.h / 2 });
    const world = (b) => { const c = center(b); const a = anchorLocal(b); return rotatePt({ x: c.x + a.x, y: c.y + a.y }, b.rotate, c); };
    const out = resizeBox(box, handle, dx, dy);
    const a0 = world(box), a1 = world(out);
    near(a0.x, a1.x, 1e-6); near(a0.y, a1.y, 1e-6);
    assert.equal(out.rotate, box.rotate, "resizing never changes the rotation");
  }
});

test("PROPERTY: keeping the aspect ratio keeps it, for every corner and at any rotation", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed * 7);
    const box = { x: 0, y: 0, w: 60 + r() * 300, h: 60 + r() * 300, rotate: r() * 360 };
    const handle = ["nw", "ne", "se", "sw"][Math.floor(r() * 4)];
    const out = resizeBox(box, handle, r() * 100 - 50, r() * 100 - 50, { keepAspect: true });
    near(out.w / out.h, box.w / box.h, 1e-9);
  }
});

test("PROPERTY: a box never shrinks below the minimum, and still keeps its aspect then", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed * 13);
    const box = { x: 10, y: 10, w: 50 + r() * 100, h: 50 + r() * 100 };
    const out = resizeBox(box, "se", -500, -500, { minSize: 12, keepAspect: seed % 2 === 0 });
    assert.ok(out.w >= 12 - 1e-9 && out.h >= 12 - 1e-9);
    if (seed % 2 === 0) near(out.w / out.h, box.w / box.h, 1e-9);
  }
});

test("resizing from the centre keeps the centre fixed", () => {
  const box = { x: 100, y: 100, w: 200, h: 100, rotate: 30 };
  const out = resizeBox(box, "e", 40, 0, { fromCenter: true });
  near(center(out).x, center(box).x); near(center(out).y, center(box).y);
  // The pointer moved 40px along the WORLD x axis; the box is turned 30 degrees,
  // so along its own axis that is 40*cos(30), doubled because it grows both ways.
  near(out.w, 200 + 2 * 40 * Math.cos((30 * Math.PI) / 180), 1e-9);
  near(resizeBox({ ...box, rotate: 0 }, "e", 40, 0, { fromCenter: true }).w, 280);
});

test("an unrotated east drag simply widens the box", () => {
  const out = resizeBox({ x: 10, y: 20, w: 100, h: 50 }, "e", 30, 999);
  assert.deepEqual([out.x, out.y, out.w, out.h], [10, 20, 130, 50]);
});

test("union and bounds of several boxes", () => {
  const u = union([{ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 40, w: 10, h: 10 }]);
  assert.deepEqual([u.x, u.y, u.w, u.h], [0, 0, 60, 50]);
  assert.equal(union([]), null);
});

test("rotating: pointing straight up is zero, snapping goes to steps, and right angles are magnetic", () => {
  assert.equal(angleTo({ x: 0, y: 0 }, { x: 0, y: -100 }), 0);
  assert.equal(angleTo({ x: 0, y: 0 }, { x: 100, y: 0 }), 90);
  assert.equal(angleTo({ x: 0, y: 0 }, { x: 100, y: -90 }, 15) % 15, 0);
  assert.equal(angleTo({ x: 0, y: 0 }, { x: 100, y: -2 }), 90, "within 3 degrees of a right angle snaps to it");
});

// ── snapping ────────────────────────────────────────────────────────────────
const frame = { w: 1000, h: 2000 };
test("a stitch near the frame's centre line snaps its centre to it, and reports the guide", () => {
  const r = snapMove({ x: 395, y: 100, w: 200, h: 100 }, [], frame, 8);
  near(r.dx, 5); // centre 495 -> 500
  assert.deepEqual(r.guides.find((g) => g.axis === "x"), { axis: "x", pos: 500, kind: "center" });
});
test("snapping reaches other stitches' edges and ignores things beyond the threshold", () => {
  const other = { x: 300, y: 600, w: 100, h: 100 };
  assert.equal(snapMove({ x: 303, y: 900, w: 50, h: 50 }, [other], frame, 8).dx, -3);
  assert.equal(snapMove({ x: 316, y: 900, w: 24, h: 50 }, [other], frame, 8).dx, 0, "10px away is beyond an 8px threshold");
});
test("the safe-area margin snaps too", () => {
  assert.equal(snapMove({ x: 78, y: 500, w: 100, h: 50 }, [], frame, 8, 80).dx, 2);
});
test("it picks the NEAREST candidate, not the first", () => {
  // Candidates at x=100 and x=104; the box edge at 102.5 is 2.5 from one and 1.5 from the other.
  const r = snapMove({ x: 102.5, y: 0, w: 10, h: 10 }, [{ x: 100, y: 5000, w: 0, h: 1 }, { x: 104, y: 5000, w: 0, h: 1 }], frame, 8);
  assert.equal(r.dx, 1.5);
});

test("fractions and pixels round-trip", () => {
  const s = { x: 0.08, y: 0.67, w: 0.84, h: 0.16 };
  const f = toFrac(toPx(s, { w: 1080, h: 1920 }), { w: 1080, h: 1920 });
  assert.deepEqual(f, s);
});
