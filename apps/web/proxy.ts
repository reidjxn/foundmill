/**
 * Next.js 16 proxy (the renamed middleware): refreshes the Supabase session on every app request (a local check for a
 * valid token, lib/supabase/middleware.ts) and redirects unauthenticated visitors to /login (docs/ARCHITECTURE.md §14,
 * BUILD §6.2). `/` is answered here (lib/auth/redirects.ts): a signed-in founder with the last-business cookie goes
 * straight to that business's Home, with no API call; one without it is served /start, which picks; a signed-out visitor
 * gets the prerendered landing page. The founder-profile gate for /b/* (AC-11.1.1) runs server-side in
 * app/b/[bid]/layout.tsx and app/start/page.tsx with the API's `founder.profile.get`.
 */
import { NextResponse, type NextRequest } from "next/server";
import { LAST_BUSINESS_COOKIE } from "@/lib/auth/constants";
import { decideRedirect } from "@/lib/auth/redirects";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const { response, authenticated } = await updateSession(request);
  const decision = decideRedirect({ pathname: request.nextUrl.pathname, search: request.nextUrl.search, authenticated, lastBusinessId: request.cookies.get(LAST_BUSINESS_COOKIE)?.value });
  if (decision.kind === "next") return response;
  // A redirect or a rewrite keeps any refreshed auth cookies, so the next request (or the rewritten render) is signed in.
  const answer = decision.kind === "redirect" ? NextResponse.redirect(new URL(decision.to, request.url)) : NextResponse.rewrite(new URL(decision.to, request.url), { request });
  for (const cookie of response.cookies.getAll()) answer.cookies.set(cookie);
  if (decision.kind === "rewrite" && decision.forgetLastBusiness) answer.cookies.set({ name: LAST_BUSINESS_COOKIE, value: "", path: "/", maxAge: 0 });
  return answer;
}

export const config = {
  matcher: [
    // Everything except static assets and metadata files; /auth/* and /login are handled inside decideRedirect.
    "/((?!_next/static|_next/image|brand/|favicon.ico|icon.svg|apple-icon.png|opengraph-image.png|robots.txt|sitemap.xml).*)",
  ],
};
