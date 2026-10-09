/**
 * The GitHub App's setup URL. After the founder installs the App on GitHub, GitHub sends them here with
 * `installation_id` and the `state` Connect put in the install link (the business id). Nothing is connected here:
 * the founder confirms the installation in Settings › Integrations, so a crafted link cannot attach another
 * installation to a business without its owner's click.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where the setup URL sends the founder: the business's Integrations tab with the installation to confirm. */
export function githubSetupRedirect(search: URLSearchParams): string {
  const installationId = search.get("installation_id") ?? "";
  const state = search.get("state") ?? "";
  if (!/^\d{1,20}$/.test(installationId) || !UUID.test(state)) return "/";
  return `/b/${state.toLowerCase()}/settings/integrations?github_installation=${installationId}`;
}

export function GET(request: Request): Response {
  return NextResponse.redirect(new URL(githubSetupRedirect(new URL(request.url).searchParams), request.url), 303);
}
