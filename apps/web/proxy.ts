/**
 * Next.js 16 proxy (the renamed middleware): refreshes the Supabase session on every app request and redirects
 * unauthenticated visitors to /login (docs/ARCHITECTURE.md §14, BUILD §6.2). The founder-profile gate for /b/*
 * (AC-11.1.1) runs server-side in app/b/[bid]/layout.tsx and app/page.tsx with the API's `founder.profile.get`.
 */
import { NextResponse, type NextRequest } from "next/server";
import { decideRedirect } from "@/lib/auth/redirects";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const { response, authenticated } = await updateSession(request);
  const decision = decideRedirect({ pathname: request.nextUrl.pathname, search: request.nextUrl.search, authenticated });
  if (decision.kind === "redirect") {
    const redirect = NextResponse.redirect(new URL(decision.to, request.url));
    // Keep any refreshed auth cookies on the redirect so the next request is already signed in.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, metadata files and the API reads served from this origin (lib/same-origin-api.ts:
    // the API checks their bearer itself, so no session work runs on them); /auth/* and /login are handled inside
    // decideRedirect. A literal: Next reads the matcher at build time.
    "/((?!api/trpc/|_next/static|_next/image|brand/|favicon.ico|icon.svg|apple-icon.png|opengraph-image.png|robots.txt|sitemap.xml).*)",
  ],
};
