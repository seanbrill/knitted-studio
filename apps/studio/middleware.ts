// The local gate. In the desktop app the server listens on 127.0.0.1, but any
// program on the machine, and any web page open in the user's browser, can send
// requests to 127.0.0.1. So when the shell starts the server it hands it a random
// token and gives the same token only to its own window; nothing else gets in.
//
//   - No token configured (plain `npm run dev`): open, as before.
//   - Token configured: every page and API call needs it, as a cookie or a header.
//   - The Host header must be the loopback address, which stops DNS rebinding,
//     where a hostile site points its own name at 127.0.0.1.

import { NextResponse, type NextRequest } from "next/server";

export const config = { matcher: "/((?!_next/static|_next/image).*)" };

export function middleware(req: NextRequest) {
  const token = process.env.KNITTED_API_TOKEN;
  if (!token) return NextResponse.next();
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (host !== "127.0.0.1" && host !== "localhost") return deny(421, "That address is not allowed.");
  const given = req.cookies.get("knitted_token")?.value ?? req.headers.get("x-knitted-token");
  if (given !== token) return deny(401, "This is the knitted desktop app. Open it from the app, not a browser.");
  return NextResponse.next();
}

const deny = (status: number, message: string) => Response.json({ error: { kind: "forbidden", message } }, { status });
