import { type NextRequest,NextResponse } from "next/server";

import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

/**
 * Gate every page and API behind the invite session cookie.
 * Never gate /webhook (Anthropic has no cookie), /api/cron/* (CRON_SECRET bearer), /login, or the
 * metadata images (icon, apple icon, share cards) that link unfurlers fetch anonymously.
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
  matcher: [
    // Gate everything except: the webhook and crons (own auth), login, static assets, and the
    // metadata images (favicon, apple icon, share cards) — link unfurlers fetch those with no cookie.
    "/((?!webhook|api/cron|login|_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon|.*opengraph-image|.*twitter-image).*)",
  ],
};
