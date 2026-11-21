import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect only: a request without a session cookie is sent to the sign-in page.
 * A cookie's presence proves nothing; real authorization is requireUser()/requireRole()
 * in src/lib/auth/session.ts, called by every page, server action and route handler.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSessionCookie = getSessionCookie(request) !== null;

  // /sign-in is public. Redirecting signed-in users away from it is the page's job (it checks the real
  // session); doing it here on a stale cookie would loop between / and /sign-in.
  if (pathname === "/sign-in") return NextResponse.next();

  if (!hasSessionCookie) {
    const url = new URL("/sign-in", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // API routes answer 401/403 themselves; skip Next internals, public brand images, and the manifest and icons, which
  // the browser fetches without a session when a page is saved to the home screen.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|brand/).*)"],
};
