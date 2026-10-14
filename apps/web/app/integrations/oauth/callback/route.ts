/**
 * Where every OAuth vendor (Google, Notion, Shopify) sends the founder back after the consent page: the one-time `code`,
 * the `state` Connect signed for this founder, business and connector, and for Shopify the store. Nothing is connected
 * here: the founder finishes on Settings › Integrations, and the api accepts the state only from the founder it was
 * signed for, for the same business and connector, before it exchanges the code. A crafted link cannot connect anything
 * to someone's business. Register `<APP_URL>/integrations/oauth/callback` as the redirect URI with each vendor.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE = /^[A-Za-z0-9_-]{1,600}\.[A-Za-z0-9_-]{1,100}$/;
const CODE = /^[A-Za-z0-9._~/+=-]{1,2000}$/;
const CONNECTOR = /^[a-z0-9_]{1,60}$/;
const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const ERROR = /^[a-z_]{1,60}$/;

/** The business and connector a state names (its first part is base64url JSON with `b` and `c`); the api verifies the signature. */
function stateTarget(state: string): { businessId: string; connectorKey: string } | null {
  try {
    const p = JSON.parse(Buffer.from(state.split(".")[0]!, "base64url").toString("utf8")) as { b?: unknown; c?: unknown };
    return typeof p.b === "string" && UUID.test(p.b) && typeof p.c === "string" && CONNECTOR.test(p.c) ? { businessId: p.b.toLowerCase(), connectorKey: p.c } : null;
  } catch {
    return null;
  }
}

/** Where the founder goes: the business's Integrations tab with the consent to finish (or the vendor's refusal). */
export function oauthCallbackRedirect(search: URLSearchParams): string {
  const state = search.get("state") ?? "";
  const target = STATE.test(state) ? stateTarget(state) : null;
  if (!target) return "/";
  const next = new URLSearchParams({ oauth_connector: target.connectorKey });
  const code = search.get("code") ?? "";
  const error = search.get("error") ?? "";
  if (CODE.test(code)) {
    next.set("oauth_code", code);
    next.set("oauth_state", state);
    const shop = (search.get("shop") ?? "").toLowerCase();
    if (SHOP.test(shop)) next.set("oauth_shop", shop);
  } else next.set("oauth_error", ERROR.test(error) ? error : "no_code");
  return `/b/${target.businessId}/settings/integrations?${next.toString()}`;
}

export function GET(request: Request): Response {
  return NextResponse.redirect(new URL(oauthCallbackRedirect(new URL(request.url).searchParams), request.url), 303);
}
