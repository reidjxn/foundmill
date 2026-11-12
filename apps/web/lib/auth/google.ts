/**
 * Continue with Google (docs/DEPLOY.md §4 "Signing in with Google"). Supabase's PKCE flow: `signInWithOAuth` stores the
 * code verifier in this browser and returns Google's consent address; Google sends the founder back through Supabase to
 * /auth/callback, which exchanges the code exactly as it does for the email link.
 *
 * Before leaving the page the button asks Supabase whether its Google provider is turned on (`GET /auth/v1/settings`,
 * public with the anon key): with the provider off, Supabase's authorize address answers a bare JSON error, a dead end
 * the founder could not get back from. Any doubt (no answer, a slow one, a refusal) reads as unavailable, and the
 * login form offers the email link instead.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { googleCallbackUrl } from "./canonical-origin";
import type { PublicEnv } from "../env";

/** How long the provider check may take before the button says Google is unavailable. */
export const GOOGLE_SETTINGS_TIMEOUT_MS = 5_000;

/** Whether the project's Google provider is on (`external.google` in Supabase Auth's public settings). */
export async function googleProviderReady(env: Pick<PublicEnv, "supabaseUrl" | "supabaseAnonKey">, fetchImpl: typeof fetch = globalThis.fetch): Promise<boolean> {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return false;
  try {
    const res = await fetchImpl(`${env.supabaseUrl}/auth/v1/settings`, { headers: { apikey: env.supabaseAnonKey }, signal: AbortSignal.timeout(GOOGLE_SETTINGS_TIMEOUT_MS) });
    if (!res.ok) return false;
    const body = (await res.json()) as { external?: { google?: unknown } };
    return body.external?.google === true;
  } catch {
    return false;
  }
}

/**
 * Starts the Google sign-in and returns the address to send the browser to, or null when it cannot start (the caller
 * shows the plain error and keeps the email form). Never navigates by itself.
 */
export async function startGoogleSignIn(
  supabase: Pick<SupabaseClient, "auth">,
  input: { env: Pick<PublicEnv, "appUrl" | "appEnv" | "supabaseUrl" | "supabaseAnonKey">; currentOrigin: string; next: string; fetchImpl?: typeof fetch },
): Promise<string | null> {
  if (!(await googleProviderReady(input.env, input.fetchImpl))) return null;
  const redirectTo = googleCallbackUrl({ appUrl: input.env.appUrl, appEnv: input.env.appEnv, currentOrigin: input.currentOrigin, next: input.next });
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
    return error || !data?.url ? null : data.url;
  } catch {
    return null;
  }
}
