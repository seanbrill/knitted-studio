import { z } from "zod";
import { PLATFORMS } from "@knitted/core";
import { finishConnect, readPasted } from "@knitted/social";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

// Where a platform's sign-in comes back to, in the person's own browser, not the app's
// window: so it has no token, and the middleware lets it in. It is safe to: it does nothing
// for a sign-in knitted did not start (the state is a one-time number knitted made).

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function page(title: string, line: string, good: boolean) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#faf7f2;color:#17110b;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:30rem;padding:2rem}h1{font-size:1.4rem;margin:0 0 .5rem}p{margin:0;color:${good ? "#4b4036" : "#8a2a12"}}@media (prefers-color-scheme:dark){body{background:#17110b;color:#faf7f2}p{color:${good ? "#cfc6bb" : "#ffb59e"}}}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(line)}</p></main></body></html>`;
  return new Response(html, { status: good ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

/** Names as a person says them: "A", "A and B", "A, B and C". */
const listed = (names: string[]) => (names.length < 2 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const a = await finishConnect(store(), { code: q.get("code"), state: q.get("state"), error: q.get("error"), errorDescription: q.get("error_description") });
    const name = PLATFORMS[a.platform].name;
    return page(`${name} is connected`, `knitted can post to ${listed(a.connected) || "this account"} now. You can close this tab and go back to knitted.`, true);
  } catch (e) {
    return page("That did not connect", (e as Error).message || "Something went wrong. Press Connect in knitted and try again.", false);
  }
}

/** The code the site's page showed, pasted into Settings when the browser could not come back by itself. */
export const POST = route(async (req: Request) => {
  const { text } = await body(req, z.object({ text: z.string().min(1).max(4000) }).strict());
  return ok(await finishConnect(store(), readPasted(text)));
});
