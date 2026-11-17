/**
 * `/.well-known/assetlinks.json` (WP-12 T8): Android app links. 404 until `APP_LINKS_ANDROID_PACKAGE` and
 * `APP_LINKS_ANDROID_SHA256` are set. Public (lib/auth/redirects.ts), read at request time.
 */
import { NextResponse } from "next/server";
import { appLinksFromProcess, assetLinks } from "@/lib/app-links.server";

export const dynamic = "force-dynamic";

export function GET() {
  const doc = assetLinks(appLinksFromProcess());
  return doc ? NextResponse.json(doc, { headers: { "cache-control": "public, max-age=3600" } }) : new NextResponse(null, { status: 404 });
}
