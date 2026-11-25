/**
 * Foundmill's OAuth client at Lovable's MCP server (founder, Nov 25, 2026: "build it with Lovable"), as a Client ID
 * Metadata Document: the client id is this document's own URL, which Lovable fetches when the founder connects, so
 * nothing is registered at Lovable. Set LOVABLE_MCP_CLIENT_ID on the gateway to `<APP_URL>/oauth/lovable-client.json`.
 * A public client (PKCE, no secret); the one redirect is the callback every OAuth vendor uses. Public (lib/auth/redirects.ts).
 */
import { NextResponse } from "next/server";
import { APP_NAME } from "@foundmill/config";
import { canonicalOrigin } from "@/lib/auth/canonical-origin";

export const dynamic = "force-dynamic";

export function lovableClientDocument(origin: string) {
  return {
    client_id: `${origin}/oauth/lovable-client.json`,
    client_name: APP_NAME,
    client_uri: origin,
    logo_uri: `${origin}/icon.svg`,
    redirect_uris: [`${origin}/integrations/oauth/callback`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export function GET() {
  return NextResponse.json(lovableClientDocument(canonicalOrigin(process.env.NEXT_PUBLIC_APP_URL)), { headers: { "cache-control": "public, max-age=3600" } });
}
