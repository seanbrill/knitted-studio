// The local gate. In the desktop app the server listens on 127.0.0.1, but any
// program on the machine, and any web page open in the user's browser, can send
// requests to 127.0.0.1. So when the shell starts the server it hands it a random
// token and gives the same token only to its own window; nothing else gets in.
//
//   - No token configured (plain `npm run dev`): open, as before.
//   - Token configured: every page and API call needs it, as a cookie or a header.
//   - Except the MCP address, /api/mcp/<key>: Claude Code and other MCP clients
//     cannot have the token, so the key in the address lets them in instead, and
//     its route checks it (app/api/mcp/[key]/route.ts).
//   - And a social platform's sign-in coming back (GET /api/social/callback), which
//     its route checks against the one-time state it made.
//   - The Host header must be the loopback address, which stops DNS rebinding,
//     where a hostile site points its own name at 127.0.0.1.

import { NextResponse, type NextRequest } from "next/server";

export const config = { matcher: "/((?!_next/static|_next/image).*)" };

export function middleware(req: NextRequest) {
  const token = process.env.KNITTED_API_TOKEN;
  if (!token) return NextResponse.next();
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (host !== "127.0.0.1" && host !== "localhost") return deny(421, "That address is not allowed.");
  if (req.nextUrl.pathname.startsWith("/api/mcp/")) return NextResponse.next();
  // A platform's sign-in coming back, in the person's own browser, which has no token. The
  // route does nothing for a sign-in knitted did not start (app/api/social/callback).
  if (req.method === "GET" && /^\/api\/social\/callback\/?$/.test(req.nextUrl.pathname)) return NextResponse.next();
  const given = req.cookies.get("knitted_token")?.value ?? req.headers.get("x-knitted-token");
  if (given !== token) return deny(401, "This is the knitted desktop app. Open it from the app, not a browser.");
  return NextResponse.next();
}

const deny = (status: number, message: string) => Response.json({ error: { kind: "forbidden", message } }, { status });
