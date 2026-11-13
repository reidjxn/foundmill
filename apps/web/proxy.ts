/**
 * Next.js 16 proxy (the renamed middleware): refreshes the Supabase session on every app request (a local check for a
 * valid token, lib/supabase/middleware.ts) and redirects unauthenticated visitors to /login (docs/ARCHITECTURE.md §14,
 * BUILD §6.2). `/` is answered here (lib/auth/redirects.ts): a signed-in founder with the last-business cookie goes
 * straight to that business's Home, with no API call; one without it is served /start, which picks; a signed-out visitor
 * gets the prerendered landing page. The founder-profile gate for /b/* (AC-11.1.1) runs server-side in
 * app/b/[bid]/layout.tsx and app/start/page.tsx with the API's `founder.profile.get`.
 *
 * Attribution (docs/NETWORK.md §5; lib/via.ts): every address accepts `?via=<reference>`. The first reference a
 * visitor arrives with is kept in the httpOnly `fm_via` cookie, on whatever this request is answered with (the page, a
 * redirect or a rewrite); a visitor who already carries one keeps it, and a value that is not a reference changes
 * nothing. No database write and no API call: the api records it once, when the visitor becomes a person. A shared
 * post's code (`s.<code>`, item 8) is also kept in `fm_post` as the last touch (a newer one replaces it), for the Follow form.
 */
import { VIA_COOKIE, VIA_PARAM } from "@foundmill/shared/via";
import { NextResponse, type NextRequest } from "next/server";
import { LAST_BUSINESS_COOKIE } from "@/lib/auth/constants";
import { decideRedirect } from "@/lib/auth/redirects";
import { isDevLike } from "@/lib/env";
import { updateSession } from "@/lib/supabase/middleware";
import { postCookie, postToRemember, viaCookie, viaToRemember } from "@/lib/via";

export async function proxy(request: NextRequest) {
  const answer = await route(request);
  const param = request.nextUrl.searchParams.get(VIA_PARAM);
  const via = viaToRemember({ param, existing: request.cookies.get(VIA_COOKIE)?.value });
  if (via) answer.cookies.set(viaCookie(via, !isDevLike()));
  // A shared post's code is also kept as the last touch (`fm_post`, 7 days): a newer one replaces it; `fm_via` is untouched.
  const post = postToRemember(param);
  if (post) answer.cookies.set(postCookie(post, !isDevLike()));
  return answer;
}

/** The session refresh and the redirect rules: what the request is answered with. */
async function route(request: NextRequest): Promise<NextResponse> {
  const { response, authenticated } = await updateSession(request);
  const decision = decideRedirect({ pathname: request.nextUrl.pathname, search: request.nextUrl.search, authenticated, lastBusinessId: request.cookies.get(LAST_BUSINESS_COOKIE)?.value });
  if (decision.kind === "next") return response;
  const forget = decision.kind === "rewrite" && decision.forgetLastBusiness;
  // The rewritten render must not read the stale business either (it picks from the request's cookies).
  if (forget) request.cookies.delete(LAST_BUSINESS_COOKIE);
  // A redirect or a rewrite keeps any refreshed auth cookies, so the next request (or the rewritten render) is signed in.
  const answer = decision.kind === "redirect" ? NextResponse.redirect(new URL(decision.to, request.url)) : NextResponse.rewrite(new URL(decision.to, request.url), { request });
  for (const cookie of response.cookies.getAll()) answer.cookies.set(cookie);
  if (forget) answer.cookies.set({ name: LAST_BUSINESS_COOKIE, value: "", path: "/", maxAge: 0 });
  return answer;
}

export const config = {
  matcher: [
    // Everything except static assets, metadata files and the API reads served from this origin (lib/same-origin-api.ts:
    // the API checks their bearer itself, so no session work runs on them); /auth/* and /login are handled inside
    // decideRedirect. A literal: Next reads the matcher at build time.
    "/((?!api/trpc/|_next/static|_next/image|brand/|favicon.ico|icon.svg|apple-icon.png|opengraph-image.png|robots.txt|sitemap.xml).*)",
  ],
};
