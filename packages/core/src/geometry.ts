// Editor geometry: pure maths, in PIXELS of the frame, no DOM.
//
// Boxes are {x, y, w, h, rotate} where x,y is the top-left of the UNROTATED box
// and rotation (degrees) turns it about its centre. Keeping this free of the DOM
// is what lets it be property-tested: resize with rotation is where editors
// quietly drift by a pixel per drag until a logo is visibly off.

export interface Box { x: number; y: number; w: number; h: number; rotate?: number; }
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export interface Pt { x: number; y: number; }

const rad = (deg: number) => (deg * Math.PI) / 180;
export const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export function rotatePt(p: Pt, deg: number, about: Pt = { x: 0, y: 0 }): Pt {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  const dx = p.x - about.x, dy = p.y - about.y;
  return { x: about.x + dx * c - dy * s, y: about.y + dx * s + dy * c };
}

/** The four corners in world space, clockwise from top-left. */
export function corners(b: Box): Pt[] {
  const c = center(b);
  return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }].map((p) => rotatePt(p, b.rotate ?? 0, c));
}

/** The axis-aligned bounds of a possibly rotated box. */
export function bounds(b: Box): Box {
  const cs = corners(b);
  const xs = cs.map((p) => p.x), ys = cs.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const bs = boxes.map(bounds);
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}

export const intersects = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const SIGN: Record<Handle, [number, number]> = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
export const handleSign = (h: Handle) => SIGN[h];

export interface ResizeOpts { keepAspect?: boolean; fromCenter?: boolean; minSize?: number; }

/**
 * Drag `handle` by a pointer delta (world pixels). The edge or corner OPPOSITE
 * the handle stays exactly where it was, even when the box is rotated: that is
 * the property the tests pin, because it is what makes a resize feel anchored.
 */
export function resizeBox(box: Box, handle: Handle, dx: number, dy: number, opts: ResizeOpts = {}): Box {
  const min = opts.minSize ?? 8;
  const theta = box.rotate ?? 0;
  const [sx, sy] = SIGN[handle];
  const local = rotatePt({ x: dx, y: dy }, -theta); // pointer delta in the box's own axes
  const k = opts.fromCenter ? 2 : 1;
  let w = box.w + sx * local.x * k;
  let h = box.h + sy * local.y * k;
  if (opts.keepAspect && box.w > 0 && box.h > 0) {
    const ratio = box.w / box.h;
    if (sx !== 0 && sy !== 0) {
      // A corner: follow whichever axis moved more, so the box tracks the pointer.
      if (Math.abs(w / box.w - 1) >= Math.abs(h / box.h - 1)) h = w / ratio; else w = h * ratio;
    } else if (sx !== 0) h = w / ratio;
    else w = h * ratio;
  }
  if (opts.keepAspect && box.w > 0 && box.h > 0) {
    // The floor applies to the SHORTER side, so the ratio survives the clamp.
    const ratio = box.w / box.h;
    w = Math.max(w, ratio >= 1 ? min * ratio : min);
    h = w / ratio;
  } else {
    w = Math.max(min, w); h = Math.max(min, h);
  }
  const c = center(box);
  // The anchor, in local coordinates relative to the centre, before and after.
  const anchorLocal = opts.fromCenter ? { x: 0, y: 0 } : { x: -sx * box.w / 2, y: -sy * box.h / 2 };
  const anchorLocalNew = opts.fromCenter ? { x: 0, y: 0 } : { x: -sx * w / 2, y: -sy * h / 2 };
  const anchorWorld = rotatePt({ x: c.x + anchorLocal.x, y: c.y + anchorLocal.y }, theta, c);
  const off = rotatePt(anchorLocalNew, theta);
  const nc = { x: anchorWorld.x - off.x, y: anchorWorld.y - off.y };
  return { x: nc.x - w / 2, y: nc.y - h / 2, w, h, rotate: theta };
}

/** The angle (degrees) a rotate handle at `pointer` implies for a box centred at `c`. */
export function angleTo(c: Pt, pointer: Pt, snapStep = 0): number {
  let a = (Math.atan2(pointer.y - c.y, pointer.x - c.x) * 180) / Math.PI + 90;
  a = ((a % 360) + 540) % 360 - 180; // normalise to [-180, 180)
  if (snapStep) a = Math.round(a / snapStep) * snapStep;
  else for (const s of [0, 45, 90, 135, -45, -90, -135, -180]) if (Math.abs(a - s) < 3) a = s; // gentle magnet on the right angles
  return Math.round(a * 100) / 100;
}

export interface Guide { axis: "x" | "y"; pos: number; kind: "edge" | "center" | "stitch" | "margin"; }
export interface SnapResult { dx: number; dy: number; guides: Guide[]; }

/**
 * Snap a moving box (unrotated) to the frame's edges and centre lines, a safe
 * margin, and every other stitch's edges and centre. `threshold` is in the same
 * pixels as the boxes (so the caller divides screen pixels by zoom).
 */
export function snapMove(moving: Box, others: Box[], frame: { w: number; h: number }, threshold: number, margin = 0): SnapResult {
  const xs: { pos: number; kind: Guide["kind"] }[] = [{ pos: 0, kind: "edge" }, { pos: frame.w / 2, kind: "center" }, { pos: frame.w, kind: "edge" }];
  const ys: { pos: number; kind: Guide["kind"] }[] = [{ pos: 0, kind: "edge" }, { pos: frame.h / 2, kind: "center" }, { pos: frame.h, kind: "edge" }];
  if (margin > 0) { xs.push({ pos: margin, kind: "margin" }, { pos: frame.w - margin, kind: "margin" }); ys.push({ pos: margin, kind: "margin" }, { pos: frame.h - margin, kind: "margin" }); }
  for (const o of others) {
    xs.push({ pos: o.x, kind: "stitch" }, { pos: o.x + o.w / 2, kind: "stitch" }, { pos: o.x + o.w, kind: "stitch" });
    ys.push({ pos: o.y, kind: "stitch" }, { pos: o.y + o.h / 2, kind: "stitch" }, { pos: o.y + o.h, kind: "stitch" });
  }
  const mine = (lo: number, size: number) => [lo, lo + size / 2, lo + size];
  const best = (cands: { pos: number; kind: Guide["kind"] }[], edges: number[]) => {
    let pick: { d: number; pos: number; kind: Guide["kind"] } | null = null;
    for (const e of edges) for (const c of cands) {
      const d = c.pos - e;
      if (Math.abs(d) <= threshold && (!pick || Math.abs(d) < Math.abs(pick.d))) pick = { d, pos: c.pos, kind: c.kind };
    }
    return pick;
  };
  const px = best(xs, mine(moving.x, moving.w)), py = best(ys, mine(moving.y, moving.h));
  const guides: Guide[] = [];
  if (px) guides.push({ axis: "x", pos: px.pos, kind: px.kind });
  if (py) guides.push({ axis: "y", pos: py.pos, kind: py.kind });
  return { dx: px?.d ?? 0, dy: py?.d ?? 0, guides };
}

/** Fractions of the frame to pixels and back. Patterns store fractions. */
export const toPx = (s: { x: number; y: number; w: number; h: number }, frame: { w: number; h: number }, rotate = 0): Box => ({ x: s.x * frame.w, y: s.y * frame.h, w: s.w * frame.w, h: s.h * frame.h, rotate });
export const toFrac = (b: Box, frame: { w: number; h: number }) => ({ x: round4(b.x / frame.w), y: round4(b.y / frame.h), w: round4(b.w / frame.w), h: round4(b.h / frame.h) });
const round4 = (n: number) => Math.round(n * 1e5) / 1e5;
