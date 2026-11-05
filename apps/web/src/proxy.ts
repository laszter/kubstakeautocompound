import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";

/** Reachable without a session; both pages work out what to show from the DB themselves. */
const PUBLIC_PATHS = new Set(["/login", "/setup"]);

/**
 * Coarse gate only, no DB access: no session cookie → redirect to /login, except a server action, which answers that
 * itself. The real check is `requireSession()`, which every page, server action and route handler under (app) calls
 * itself (cookie validity, expiry, current credential).
 */
export function proxy(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();
  if (!request.cookies.has(SESSION_COOKIE_NAME)) {
    // The client router can't follow a 307 on an action's POST and shows its error page. `requireSession()` in the
    // action redirects in a form it understands, and a made-up cookie already gets this far.
    if (request.method === "POST" && request.headers.has("next-action")) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Never gate the health check, Next internals or static files (anything with a dot).
  matcher: ["/((?!api/health|_next/|favicon.ico|.*\\..*).*)"],
};
