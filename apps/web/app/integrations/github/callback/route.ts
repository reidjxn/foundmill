/**
 * Where GitHub sends the founder after they install the App (the App's callback URL, with "Request user authorization
 * (OAuth) during installation" on): `installation_id`, a one-time `code` naming who installed it, and the `state`
 * Connect signed for this founder and business. Nothing is connected here: the founder confirms on Settings ›
 * Integrations, and the api accepts the state only from the founder it was signed for, while the gateway checks with
 * GitHub that they can manage the installation. A crafted link cannot attach an installation to someone's business.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE = /^[A-Za-z0-9_-]{1,400}\.[A-Za-z0-9_-]{1,100}$/;
const CODE = /^[A-Za-z0-9_-]{1,100}$/;

/** The business a state names (its first part is base64url JSON with `b`); the api verifies the signature. */
function stateBusiness(state: string): string | null {
  try {
    const b = (JSON.parse(Buffer.from(state.split(".")[0]!, "base64url").toString("utf8")) as { b?: unknown }).b;
    return typeof b === "string" && UUID.test(b) ? b.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Where the founder goes: the business's Integrations tab with the installation to confirm. */
export function githubSetupRedirect(search: URLSearchParams): string {
  const installationId = search.get("installation_id") ?? "";
  const state = search.get("state") ?? "";
  const code = search.get("code") ?? "";
  const businessId = STATE.test(state) ? stateBusiness(state) : null;
  if (!/^\d{1,20}$/.test(installationId) || !businessId) return "/";
  const next = new URLSearchParams({ github_installation: installationId, github_state: state });
  if (CODE.test(code)) next.set("github_code", code);
  return `/b/${businessId}/settings/integrations?${next.toString()}`;
}

export function GET(request: Request): Response {
  return NextResponse.redirect(new URL(githubSetupRedirect(new URL(request.url).searchParams), request.url), 303);
}
