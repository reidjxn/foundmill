/**
 * `/.well-known/apple-app-site-association` (WP-12 T8): iOS universal links. 404 until `APP_LINKS_IOS_APP_ID` is set.
 * Public (lib/auth/redirects.ts), read at request time so the value can be set without a build.
 */
import { NextResponse } from "next/server";
import { appLinksFromProcess, appleAppSiteAssociation } from "@/lib/app-links.server";

export const dynamic = "force-dynamic";

export function GET() {
  const doc = appleAppSiteAssociation(appLinksFromProcess());
  return doc ? NextResponse.json(doc, { headers: { "cache-control": "public, max-age=3600" } }) : new NextResponse(null, { status: 404 });
}
