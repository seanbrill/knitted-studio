// A small public website, for the BUILT studio server (links.e2e.mjs loads this with
// `--import`). It answers for one public documentation address, 203.0.113.9, and hands
// every other request to the real fetch. The address guard still runs on every hop, as
// it does for anyone: nothing here relaxes it, and nothing in a release loads this file.

const HOST = "203.0.113.9";
// A 96px violet square: the site's icon, and a photo to import.
const violet = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABB0lEQVR4nO3ZsQ3DMADEQA+c5bwdy0yQNIbxKg7QBASfkeLr/uTcvyFc6Nx/FQEogHqyEgYFUAzqvZ8aEwugGJSJtbrQalAAxaBMLA3qzP8VRDqAYlAmlgY177FIB1AMysSad8dFMYBiUCbWPEAeqwEUgzKxNKh5jEU6gGJQJtY8Oi6KARSDMrEOOb6sBlAMysTSoOY9FukAikGZWPPuuCgGUAzKxJoHyGM1gGJQJpYGNY+xSAdQDMrEmkfHRTGAYlAm1iHHl9UAikGZWBrUvMciHUAxKBNr3h0XxQCKQZlY8wB5rAZQDMrE0qDmMRbpAIpBmVjz6LgoBlAMysQ65PiyGkA9MegLOJb4V/2hYVIAAAAASUVORK5CYII=", "base64");
const ROUTES = {
  "/": ["text/html; charset=utf-8", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture Records</title>
<link rel="stylesheet" href="/site.css"><link rel="apple-touch-icon" sizes="180x180" href="/icon.png"></head>
<body><a class="btn" href="/listen">Listen</a><h1>New records</h1><p>Every week.</p></body></html>`],
  "/site.css": ["text/css", `:root { --brand: #b16cf8; --bg: #150829; --fg: #ffffff }
body { background: var(--bg); color: var(--fg); font-family: Inter, sans-serif }
h1 { font-family: Fraunces, serif }
.btn { background: var(--brand); color: var(--bg) }`],
  "/icon.png": ["image/png", violet],
  "/Hero%20photo.png": ["image/png", violet],
};

const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== HOST) return real(input, init);
  const route = ROUTES[url.pathname];
  if (!route) return new Response("not here", { status: 404, headers: { "content-type": "text/html" } });
  return new Response(route[1], { status: 200, headers: { "content-type": route[0] } });
};
