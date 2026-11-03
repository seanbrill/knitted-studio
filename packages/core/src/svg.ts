// SVG is code. An uploaded SVG can carry <script>, event handlers, and
// references that make a request. It is stored and rendered, so it is cleaned on
// the way in. This is a deliberately strict allow-list-by-removal: when in
// doubt, drop it. A logo that loses an exotic feature is a nuisance; a logo that
// runs script is a hole.

const DROP_TAGS = /<\s*(script|foreignObject|iframe|object|embed|audio|video|link|meta|style\b[^>]*\bsrc)\b[\s\S]*?(<\s*\/\s*\1\s*>|\/\s*>)/gi;
const LONE_TAGS = /<\s*\/?\s*(script|foreignObject|iframe|object|embed|link|meta)\b[^>]*>/gi;
const ON_ATTR = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL = /\s+(?:xlink:)?href\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi;
// An external reference: anything other than a fragment (#id) or an inline data: image.
const EXT_HREF = /\s+(?:xlink:)?href\s*=\s*("(?!#|data:image\/)[^"]*"|'(?!#|data:image\/)[^']*')/gi;
const CSS_IMPORT = /@import[^;]*;?/gi;
const CSS_URL = /url\(\s*(['"]?)(?!#|data:image\/)[^)]*\1\s*\)/gi;

export function sanitiseSvg(svg: string): { svg: string; changed: boolean } {
  const before = svg;
  let s = svg.replace(/<!ENTITY[\s\S]*?>/gi, "").replace(/<!DOCTYPE[\s\S]*?\]>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "");
  s = s.replace(DROP_TAGS, "").replace(LONE_TAGS, "").replace(ON_ATTR, "").replace(JS_URL, "").replace(EXT_HREF, "").replace(CSS_IMPORT, "").replace(CSS_URL, "none");
  return { svg: s, changed: s !== before };
}

export function looksLikeSvg(buf: Buffer): boolean {
  const head = buf.subarray(0, 2048).toString("utf8").toLowerCase();
  return head.includes("<svg");
}
