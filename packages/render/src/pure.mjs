// A Pattern as HTML. PURE: no Node imports, so the editor in the browser and the
// engine in a render worker run this very file and cannot disagree about what a
// Pattern looks like (decision D8: re-render the design, never re-implement it).
//
// Stitch geometry is FRACTIONS of the frame, so one set of coordinates serves
// every output size. Font sizes are fractions of the frame WIDTH, for the same
// reason. Anything that is a token (`$color.primary`, `$font.display`) resolves
// against the Swatch here, so changing the brand restyles every Pattern.

import { FALLBACK_SWATCH, resolveStyle, colorFor, fontFor, fillTemplate, compileMotion, entersAt, pieceTimes, textClip } from "@knitted/core";

/**
 * @typedef {{ url: string, kind: string, mime?: string, width?: number, height?: number, meta?: Record<string, any> }} YarnRef
 * @typedef {{
 *   swatch?: import("@knitted/core").Swatch,
 *   yarn?: (id: string) => YarnRef | undefined,
 *   fontUrl?: (file: string) => string,
 *   part?: (id: string) => import("@knitted/core").Part | undefined,
 *   footage?: (stitchId: string) => { url: string, offsetMs: number } | undefined,
 *   fontFaces?: string,
 *   mode?: "render" | "edit",
 * }} RenderCtx
 */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const px = (n) => `${Math.round(n * 100) / 100}px`;

/**
 * A short word that starts a sentence, or the text, keeps to the word after it, with a no-break
 * space: "5 GB. No card. It / never charges." left "It" alone at the end of a line in a real
 * story, and "5 / GB" can come apart the same way.
 */
export function keepShortWords(text) {
  return String(text ?? "").replace(/(^|[.!?:]\s+)([\p{L}\p{N}'\u2019]{1,3}) (?=\S)/gu, "$1$2\u00a0");
}

/** `*word*` is the one accent word in a headline (Instrument Serif italic). */
export function richText(text) {
  return esc(keepShortWords(text)).replace(/\*([^*\n]+)\*/g, '<em class="accent">$1</em>').replace(/\n/g, "<br>");
}

/**
 * Text that plays its own type-on or stitch-in (core's textClip): every character, or every
 * word, in a span of its own with its moment as its animation-delay. The same accents and
 * line breaks as richText, and the same layout, since a piece not yet shown keeps its place.
 */
export function playedText(text, clip) {
  const typeOn = clip.preset === "type-on";
  const pieces = [];
  keepShortWords(text).split(/(\*[^*\n]+\*)/).forEach((part, k) => {
    const accent = k % 2 === 1, body = accent ? part.slice(1, -1) : part;
    if (typeOn) for (const ch of Array.from(body)) pieces.push({ t: ch, accent, kind: ch === "\n" ? "br" : ch === " " ? "sp" : "piece" });
    // Words joined by a no-break space (keepShortWords) rise in as one: the browser breaks
    // between two inline-blocks even across one.
    else for (const w of body.split(/([^\S\u00a0]+)/)) if (w) pieces.push({ t: w, accent, kind: /\S/.test(w) ? "piece" : w.includes("\n") ? "br" : "sp" });
  });
  // A character's moment counts the spaces before it, so typing keeps an even pace; a word's does not.
  const timed = typeOn ? pieces : pieces.filter((p) => p.kind === "piece");
  const at = pieceTimes(clip, timed.length);
  timed.forEach((p, i) => { p.at = at[i]; });
  let out = "", inAccent = false;
  for (const p of pieces) {
    if (p.accent !== inAccent) { out += p.accent ? '<em class="accent">' : "</em>"; inAccent = p.accent; }
    // Spaces are kept as written (a code block's indentation is pre-wrap), line breaks as <br>.
    out += p.kind !== "piece" ? p.t.replace(/\n/g, "<br>") : `<span class="${typeOn ? "kc" : "kw"}" style="animation-delay:${p.at}ms">${esc(p.t)}</span>`;
  }
  return inAccent ? `${out}</em>` : out;
}

function boxCss(s) {
  const r = (n) => Math.round(n * 1e4) / 100; // fraction to percent, 2 decimals
  return `left:${r(s.x)}%;top:${r(s.y)}%;width:${r(s.w)}%;height:${r(s.h)}%`;
}

/** The inline style that places and decorates one stitch. */
export function stitchStyle(s, frame, ctx) {
  const sw = ctx.swatch ?? FALLBACK_SWATCH;
  const st = resolveStyle(sw, s.style);
  const css = [boxCss(s)];
  const radius = num(st.radius, null);
  if (radius !== null) css.push(`border-radius:${px(radius * frame.w)}`);
  if (typeof st.background === "string" && s.kind !== "image") css.push(`background:${st.background}`);
  if (num(st.opacity, 1) < 1) css.push(`opacity:${num(st.opacity, 1)}`);
  if (num(st.rotate, 0)) css.push(`transform:rotate(${num(st.rotate, 0)}deg)`);
  if (typeof st.blend === "string") css.push(`mix-blend-mode:${esc(st.blend)}`);
  if (num(st.borderWidth, 0) > 0) css.push(`border:${px(st.borderWidth * frame.w)} solid ${typeof st.borderColor === "string" ? st.borderColor : colorFor(sw, "text")}`);
  if (st.shadow) css.push(`box-shadow:0 ${px(frame.w * 0.01)} ${px(frame.w * 0.03)} rgba(0,0,0,.25)`);
  if (s.kind === "text") {
    const fam = typeof st.fontFamily === "string" ? st.fontFamily : fontFor(sw, "display");
    // Single quotes: this string is placed inside a double-quoted style="..."
    // attribute, and a double quote here ended the attribute early and silently
    // dropped every declaration after it (text fell back to Times).
    css.push(`font-family:'${String(fam).replace(/['"<>&]/g, "")}',sans-serif`);
    css.push(`font-size:${px(num(st.fontSize, 0.05) * frame.w)}`);
    css.push(`font-weight:${num(st.fontWeight, 700)}`);
    css.push(`line-height:${num(st.lineHeight, 1.05)}`);
    css.push(`letter-spacing:${num(st.letterSpacing, -0.02)}em`);
    const align = ["left", "center", "right"].includes(st.textAlign) ? st.textAlign : "left";
    css.push(`text-align:${align}`);
    // A pop or grow-in scales from where the words are, not from the middle of a wide box:
    // left-aligned lines scaled from the centre slid sideways as they grew. A rotated box keeps
    // its centre, since moving the pivot would move the box.
    const va0 = { top: "0%", middle: "50%", bottom: "100%" }[st.verticalAlign] ?? "0%";
    if (!num(st.rotate, 0)) css.push(`transform-origin:${{ left: "0%", center: "50%", right: "100%" }[align]} ${va0}`);
    // No word left alone on a headline's last line: headline-sized text is balanced (even
    // lines), smaller text gets the browser's pretty wrapping. Widows were in 15+ real knits.
    css.push(`text-wrap:${num(st.fontSize, 0.05) >= 0.06 ? "balance" : "pretty"}`);
    // Code keeps its indentation and its runs of spaces.
    if (s.style?.fontFamily === "$font.mono" || fam === fontFor(sw, "mono")) css.push("white-space:pre-wrap");
    css.push(`color:${typeof st.color === "string" ? st.color : colorFor(sw, "text")}`);
    if (st.textTransform) css.push(`text-transform:${esc(st.textTransform)}`);
    const va = { top: "flex-start", middle: "center", bottom: "flex-end" }[st.verticalAlign] ?? "flex-start";
    css.push(`display:flex;flex-direction:column;justify-content:${va}`);
  }
  return css.join(";");
}

/** The heat grade from the theme: desaturate, then multiply with ember or red. */
function heatLayer(st, sw) {
  const heat = st.heat ?? (st.heatGrade ? sw.rules?.heatGrade?.hue : undefined);
  if (!heat) return { filter: "", overlay: "" };
  const strength = num(st.heatStrength, sw.rules?.heatGrade?.strength ?? 0.7);
  const hue = heat === "red" ? "#d92414" : "#df5a0f";
  return { filter: "grayscale(1) contrast(1.05)", overlay: `<i class="heat" style="background:${hue};opacity:${strength}"></i>` };
}

function mediaFilter(st, extra) {
  const f = [extra];
  if (num(st.brightness, 1) !== 1) f.push(`brightness(${num(st.brightness, 1)})`);
  if (num(st.contrast, 1) !== 1) f.push(`contrast(${num(st.contrast, 1)})`);
  if (num(st.saturate, 1) !== 1) f.push(`saturate(${num(st.saturate, 1)})`);
  if (num(st.blur, 0) > 0) f.push(`blur(${num(st.blur, 0)}px)`);
  return f.filter(Boolean).join(" ");
}

/**
 * A Part instance: the Part's own stitches, drawn inside the instance's box.
 * Child sizes are fractions of the PART's width, so resizing the instance scales
 * everything in it. A Part that has been deleted shows as a visible, fixable gap
 * in the editor and as nothing in a render.
 */
function partHtml(s, frame, ctx, attrs) {
  const part = ctx.part?.(s.partId);
  if (!part) return `<div ${attrs}>${ctx.mode === "edit" ? '<span class="missing">Missing part</span>' : ""}</div>`;
  const over = s.overrides ?? {};
  if (part.kind === "code") {
    const values = Object.fromEntries((part.slots ?? []).map((sl) => [sl.name, over[sl.name] ?? sl.default ?? ""]));
    // No scripts, no network: the sandbox has neither, and a CSP says so again inside.
    const doc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:"><style>*,*::before,*::after{box-sizing:border-box;animation-play-state:paused!important}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}${part.css ?? ""}</style>${fillTemplate(part.html ?? "", values)}`;
    return `<div ${attrs}><iframe class="partframe" sandbox="allow-same-origin" title="" srcdoc="${esc(doc)}"></iframe></div>`;
  }
  const w = (s.w * frame.w), h = (s.h * frame.h);
  const inner = { w, h };
  const kids = (part.stitches ?? []).map((c) => {
    const v = c.slot ? over[c.slot] : undefined;
    const child = v === undefined ? c : c.kind === "text" ? { ...c, content: v } : c.kind === "image" ? { ...c, yarnId: v } : c;
    return stitchHtml(child, inner, ctx);
  }).join("");
  return `<div ${attrs}><div class="partstage">${kids}</div></div>`;
}

/** One stitch as HTML. */
export function stitchHtml(s, frame, ctx) {
  const sw = ctx.swatch ?? FALLBACK_SWATCH;
  const st = resolveStyle(sw, s.style);
  // A hidden stitch is not drawn in a render at all; the editor keeps it in the
  // layers panel so it can be shown again.
  if (st.hidden) return "";
  const attrs = `class="stitch ${esc(s.kind)}" data-stitch-id="${esc(s.id)}" data-slot="${esc(s.slot ?? "")}" style="${stitchStyle(s, frame, ctx)}"`;

  if (s.kind === "part") return partHtml(s, frame, ctx, attrs);

  if (s.kind === "text") {
    const clamp = num(st.maxLines, 0) > 0 ? ` data-max-lines="${Math.floor(st.maxLines)}"` : "";
    const fit = st.fit === "shrink" ? ' data-fit="shrink"' : "";
    const played = textClip(s, ctx.motion);
    return `<div ${attrs}${clamp}${fit}><span class="t">${played ? playedText(s.content, played) : richText(s.content)}</span></div>`;
  }

  if (s.kind === "image" || s.kind === "video") {
    const y = s.yarnId ? ctx.yarn?.(s.yarnId) : undefined;
    const heat = heatLayer(st, sw);
    const fit = ["cover", "contain", "fill"].includes(st.fit) ? st.fit : "cover";
    const pos = `${num(st.focalX, 0.5) * 100}% ${num(st.focalY, 0.5) * 100}%`;
    const flip = st.flipX ? "transform:scaleX(-1);" : "";
    const bg = typeof st.background === "string" ? st.background : "transparent";
    if (y && (y.kind === "image" || y.kind === "video")) {
      // A video plays: its clock is the pattern's, set by seek(), so the editor and a knit show the same frame.
      // It starts from its first frame (or from fromMs into the file) when its stitch starts to
      // come in: on the pattern's own clock, footage in a second scene began 5 s into its file.
      // Where it cannot be read (no decoder for it), its still stays in its place.
      if (s.kind === "video" && y.kind === "video") {
        const poster = y.posterUrl ? ` poster="${esc(y.posterUrl)}"` : "";
        // A knit plays a copy made the size it is drawn (engine footage.mjs), cut from the in-point.
        const copy = ctx.footage?.(s.id);
        const clock = ` data-from="${Math.round(entersAt(s.id, ctx.motion))}" data-in="${Math.max(0, Math.round(num(st.fromMs, 0) - (copy?.offsetMs ?? 0)))}"`;
        return `<div ${attrs}><div class="media" style="background:${bg}"><video class="kn-video" src="${esc(copy?.url ?? y.url)}"${poster}${clock} muted playsinline preload="auto" style="width:100%;height:100%;display:block;object-fit:${fit};object-position:${pos};${flip}filter:${esc(mediaFilter(st, heat.filter))}"></video>${heat.overlay}</div></div>`;
      }
      const src = s.kind === "video" && y.meta?.thumb ? y.posterUrl ?? y.url : y.url;
      return `<div ${attrs}><div class="media" style="background:${bg}"><img src="${esc(src)}" alt="" style="object-fit:${fit};object-position:${pos};${flip}filter:${esc(mediaFilter(st, heat.filter))}">${heat.overlay}</div></div>`;
    }
    // No yarn yet. In the editor that is a visible, fixable placeholder; in a
    // render it is just the field colour, and the Knit quality gates have
    // already told the user it was missing.
    const missing = s.yarnId && ctx.mode === "edit" ? '<span class="missing">Missing yarn</span>' : "";
    return `<div ${attrs}><div class="media" style="background:${bg === "transparent" ? "var(--kn-ph)" : bg}">${missing}</div></div>`;
  }

  if (s.kind === "shape") {
    const shape = st.shape === "ellipse" ? "border-radius:50%;" : "";
    const fill = typeof st.background === "string" ? st.background : colorFor(sw, "primary");
    if (st.shape === "chevrons") return `<div ${attrs}>${chevronRows(sw, st)}</div>`;
    return `<div ${attrs}><div class="media" style="${shape}background:${fill}"></div></div>`;
  }
  return `<div ${attrs}></div>`;
}

/** The stitch motif as a shape: rows of Vs, drawn in the swatch's neutral on its primary by default. */
function chevronRows(sw, st) {
  const color = typeof st.color === "string" ? st.color : colorFor(sw, "neutral");
  const n = Math.max(2, Math.min(24, Math.round(num(st.count, 8))));
  const v = `<svg viewBox="0 0 10 7" preserveAspectRatio="none"><path d="M1 1L5 5.6L9 1" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `<div class="chevrons" style="grid-template-columns:repeat(${n},1fr)">${Array.from({ length: n }, () => v).join("")}</div>`;
}

export function bodyHtml(pattern, ctx) {
  const frame = pattern.size;
  const withMotion = { ...ctx, motion: pattern.motion };
  return (pattern.stitches ?? []).map((s) => stitchHtml(s, frame, withMotion)).join("\n");
}

/** Which bundled families a pattern uses, so a page only declares what it needs. */
export function familiesUsed(pattern, swatch) {
  const sw = swatch ?? FALLBACK_SWATCH;
  const set = new Set([fontFor(sw, "display"), fontFor(sw, "body"), fontFor(sw, "mono"), "Instrument Serif"]);
  for (const s of pattern.stitches ?? []) {
    const f = resolveStyle(sw, s.style).fontFamily;
    if (typeof f === "string") set.add(f);
  }
  return [...set].filter(Boolean);
}

const BASE_CSS = `
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0;padding:0;overflow:hidden}
  .stage{position:relative;overflow:hidden}
  .stitch{position:absolute;margin:0}
  .stitch .t{display:block;max-width:100%}
  .stitch.text .t em.accent{font-family:"Instrument Serif",Georgia,serif;font-style:italic;font-weight:400;letter-spacing:0}
  .media{position:absolute;inset:0;overflow:hidden;isolation:isolate;border-radius:inherit}
  .media img{width:100%;height:100%;display:block}
  .media .heat{position:absolute;inset:0;mix-blend-mode:multiply}
  .missing{position:absolute;inset:0;display:grid;place-items:center;font:600 14px/1 system-ui,sans-serif;color:#6a5d50;text-align:center}
  .partstage{position:absolute;inset:0}
  .partframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent}
  .chevrons{display:grid;width:100%;height:100%;align-content:center;gap:0}
  .chevrons svg{width:100%;height:auto;display:block}
  /* Every animation is paused and driven by seek(). A page that animates on its
     own renders a different video each run. */
  *,*::before,*::after{animation-play-state:paused !important}
`;

const EDIT_CSS = `
  :root{--kn-ph:repeating-linear-gradient(45deg,#f1e6d9 0 12px,#f7efe4 12px 24px)}
  .stitch{pointer-events:none;user-select:none}
`;
const RENDER_CSS = `:root{--kn-ph:transparent}`;

/** The stage contract the engine depends on, plus text fitting. */
function stageScript(duration, mode) {
  return `
  function fitAll(){
    // Fitted as it is once everything has landed: a word still waiting to rise in sits below its
    // line, and shrinking the text to make room for it left it too small.
    const still = document.createElement('style'); still.textContent = '.stitch,.stitch *{animation:none!important}';
    document.head.append(still);
    try { fitEach(); } finally { still.remove(); }
    // Turned back on, the animations start again from 0: put them back where the clock is.
    const at = window.__t || 0;
    for (const a of document.getAnimations()) a.currentTime = at;
  }
  function fitEach(){
    for (const el of document.querySelectorAll('[data-fit="shrink"], [data-max-lines]')) {
      const t = el.querySelector('.t'); if (!t) continue;
      const base = parseFloat(el.style.fontSize);
      const maxLines = parseInt(el.dataset.maxLines || '0', 10);
      if (el.dataset.fit === 'shrink') {
        let lo = base * 0.2, hi = base, best = lo;
        for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; el.style.fontSize = mid + 'px';
          if (t.scrollHeight <= el.clientHeight + 1 && t.scrollWidth <= el.clientWidth + 1) { best = mid; lo = mid; } else hi = mid; }
        el.style.fontSize = best + 'px';
      }
      if (maxLines > 0) { const lh = parseFloat(getComputedStyle(el).lineHeight) || base * 1.05;
        t.style.display = '-webkit-box'; t.style.webkitBoxOrient = 'vertical'; t.style.webkitLineClamp = String(maxLines); t.style.overflow = 'hidden'; t.style.maxHeight = (lh * maxLines) + 'px'; }
    }
  }
  window.__stage = {
    duration: ${Number(duration) || 0},
    seek(ms) {
      window.__t = ms;
      // A stitch sliding in gets its own layer WHILE it slides, and loses it once it stops.
      // Drawn in place, it moves in whole pixels (2, 1, 2, 0 at the slow end of an ease),
      // which reads as choppy; on a layer it moves by fractions, as the ease says. Left on
      // a layer at rest, it stays resampled and softer than text that never moved, so the
      // layer goes. Scale moves gain nothing from a layer and are drawn in place.
      const sliding = new Set(), slides = new Set();
      for (const a of document.getAnimations()) {
        a.currentTime = ms;
        if (!String(a.animationName || "").startsWith("kn-slide-")) continue;
        const el = a.effect && a.effect.target; if (!el) continue;
        slides.add(el);
        const c = a.effect.getComputedTiming();
        if (ms > c.delay && ms < c.delay + c.activeDuration) sliding.add(el);
      }
      for (const el of slides) el.style.willChange = sliding.has(el) ? "translate" : "";
      // A code Part lives in its own (script-free, same-origin) frame: reach in and set its clock too.
      for (const f of document.querySelectorAll("iframe.partframe")) { try { for (const a of f.contentDocument.getAnimations()) a.currentTime = ms; } catch {} }
      document.documentElement.style.setProperty("--t", ms + "ms");
      // Each video to its own moment (from when its stitch comes in), looping when the pattern runs
      // longer: a frame is taken once they are all there.
      const vids = [...document.querySelectorAll("video.kn-video")].filter(v => v.readyState >= 1 && v.duration > 0);
      // A millisecond late. Frames are asked for at whole milliseconds (33, 67, 100, 133...), and
      // footage frame 1 starts at 33.33: at 33 the browser showed frame 0 again, every third frame,
      // so footage stuttered, a frame twice and then one skipped. Seen in real Story knits.
      return Promise.all(vids.map(v => new Promise(r => {
        const own = Math.max(0, ms - (+v.dataset.from || 0)) + (+v.dataset.in || 0);
        const at = Math.min((own / 1000) % v.duration + 0.001, v.duration - 0.001);
        if (Math.abs(v.currentTime - at) < 0.0005) return r();
        const t = setTimeout(r, 1500);
        v.addEventListener("seeked", () => { clearTimeout(t); r(); }, { once: true });
        v.currentTime = at;
      })));
    },
    async ready() {
      if (document.fonts) await document.fonts.ready;
      await Promise.all([...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; })));
      await Promise.all([...document.querySelectorAll("video.kn-video")].filter(v => v.readyState < 2).map(v => new Promise(r => { const t = setTimeout(r, 8000); const done = () => { clearTimeout(t); r(); }; v.addEventListener("loadeddata", done, { once: true }); v.addEventListener("error", done, { once: true }); })));
      await Promise.all([...document.querySelectorAll("iframe.partframe")].map(f => new Promise(r => { if (f.contentDocument && f.contentDocument.readyState === "complete") r(); else f.addEventListener("load", r, { once: true }); })));
      fitAll();
      // Two frames, so the first paint has certainly happened.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
  };
  ${mode === "edit" ? `window.__edit = {
    // Content and motion are replaced together, then the clock is put back where it was,
    // so editing while scrubbed does not snap the preview back to the start.
    set(html, css) { if (css !== undefined) document.getElementById('kn-motion').textContent = css; document.getElementById('root').innerHTML = html; fitAll(); for (const v of document.querySelectorAll("video.kn-video")) v.addEventListener("loadedmetadata", () => window.__stage.seek(window.__t || 0), { once: true }); if (window.__t) window.__stage.seek(window.__t); },
    fit: fitAll };
  if (document.fonts) document.fonts.ready.then(fitAll);` : ""}
  `;
}

/**
 * A Pattern as a standalone page. A Pattern authored with its own html/css
 * supplies the body instead, and still gets the stage contract.
 *
 * @param {import("@knitted/core").Pattern} pattern
 * @param {RenderCtx} [ctx]
 */
export function pageFor(pattern, ctx = {}) {
  const { w, h } = pattern.size;
  const sw = ctx.swatch ?? FALLBACK_SWATCH;
  const mode = ctx.mode ?? "render";
  const body = pattern.html ?? bodyHtml(pattern, { ...ctx, mode });
  const faces = ctx.fontFaces ?? "";
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=${w}">
<style>
  ${faces}
  ${BASE_CSS}
  ${mode === "edit" ? EDIT_CSS : RENDER_CSS}
  html,body{width:${w}px;height:${h}px;background:${mode === "edit" ? colorFor(sw, "background") : "transparent"}}
  .stage{width:${w}px;height:${h}px;background:${typeof pattern.background === "string" ? pattern.background : mode === "edit" ? colorFor(sw, "background") : "transparent"}}
  ${pattern.css ?? ""}
</style>
<style id="kn-motion">${compileMotion(pattern)}</style></head>
<body>
<div class="stage" id="root">
${body}
</div>
<script>${stageScript(pattern.durationMs, mode)}</script>
</body></html>`;
}
