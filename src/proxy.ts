import { type NextRequest,NextResponse } from "next/server";

import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

/**
 * Gate every page and API behind the invite session cookie.
 * Never gate /webhook (Anthropic has no cookie), /api/cron/* (CRON_SECRET bearer), or /login.
 */
export async function proxy(request: NextRequest) {
  if (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.search = request.nextUrl.search; // carries ?invite=… through
  login.searchParams.set("next", request.nextUrl.pathname);

  // The root is the splash: rewrite so the URL stays transcripts.fyi/?invite=…
  if (request.nextUrl.pathname === "/") return NextResponse.rewrite(login);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!webhook|api/cron|login|_next/static|_next/image|favicon.ico).*)"],
};
