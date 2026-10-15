/**
 * Next.js 16 proxy (the renamed middleware): refreshes the Supabase session on every app request (a local check for a
 * valid token, lib/supabase/middleware.ts) and redirects unauthenticated visitors to /login (docs/ARCHITECTURE.md §14,
 * BUILD §6.2). A signed-in `/` with the last-business cookie goes straight to that business's Home from here, with no
 * API call (lib/auth/redirects.ts). The founder-profile gate for /b/* (AC-11.1.1) runs server-side in
 * app/b/[bid]/layout.tsx and app/page.tsx with the API's `founder.profile.get`.
 */
import { NextResponse, type NextRequest } from "next/server";
import { LAST_BUSINESS_COOKIE } from "@/lib/auth/constants";
import { decideRedirect } from "@/lib/auth/redirects";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const { response, authenticated } = await updateSession(request);
  const decision = decideRedirect({ pathname: request.nextUrl.pathname, search: request.nextUrl.search, authenticated, lastBusinessId: request.cookies.get(LAST_BUSINESS_COOKIE)?.value });
  if (decision.kind === "redirect") {
    const redirect = NextResponse.redirect(new URL(decision.to, request.url));
    // Keep any refreshed auth cookies on the redirect so the next request is already signed in.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  if (decision.forgetLastBusiness) response.cookies.set({ name: LAST_BUSINESS_COOKIE, value: "", path: "/", maxAge: 0 });
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and metadata files; /auth/* and /login are handled inside decideRedirect.
    "/((?!_next/static|_next/image|brand/|favicon.ico|icon.svg|apple-icon.png|opengraph-image.png|robots.txt|sitemap.xml).*)",
  ],
};
