/**
 * Public environment of the web bundle (docs/ARCHITECTURE.md §3: the browser only sees NEXT_PUBLIC_*).
 * Every variable is referenced literally so Next.js can inline it; next.config.ts supplies the fallbacks.
 */
export type PublicAppEnv = "development" | "test" | "staging" | "production";

export interface PublicEnv {
  appEnv: PublicAppEnv;
  apiUrl: string;
  streamUrl: string;
  /** Hocuspocus WebSocket (apps/collab); empty when unset, which the spec editor reads as "edit locally". */
  collabUrl: string;
  ingestUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  integrationsMode: "mock" | "live";
  /** NEXT_PUBLIC_APP_URL: the canonical web origin magic links return to; empty means APP_ORIGIN outside development (lib/auth/canonical-origin.ts). */
  appUrl: string;
  /**
   * NEXT_PUBLIC_AUTH_GOOGLE=on: the sign-in page offers "Continue with Google" (Supabase's Google provider, docs/DEPLOY.md
   * §4 "Signing in with Google"). Off unless exactly "on", so the button never appears before the provider is set up.
   */
  authGoogle: boolean;
}

const APP_ENVS: readonly PublicAppEnv[] = ["development", "test", "staging", "production"];

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function parsePublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  const appEnvRaw = raw.NEXT_PUBLIC_APP_ENV ?? "development";
  const appEnv = (APP_ENVS as readonly string[]).includes(appEnvRaw) ? (appEnvRaw as PublicAppEnv) : "development";
  return {
    appEnv,
    apiUrl: trimSlash(raw.NEXT_PUBLIC_API_URL || "http://localhost:4000"),
    streamUrl: trimSlash(raw.NEXT_PUBLIC_STREAM_URL || "ws://localhost:4003"),
    // No default: an empty collab URL keeps spec edits local (apps/web SpecEditor saves through product.spec.editBlock).
    collabUrl: trimSlash(raw.NEXT_PUBLIC_COLLAB_URL ?? ""),
    ingestUrl: trimSlash(raw.NEXT_PUBLIC_INGEST_URL || "http://localhost:4005"),
    supabaseUrl: trimSlash(raw.NEXT_PUBLIC_SUPABASE_URL ?? ""),
    supabaseAnonKey: raw.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    integrationsMode: raw.NEXT_PUBLIC_INTEGRATIONS_MODE === "live" ? "live" : "mock",
    appUrl: trimSlash(raw.NEXT_PUBLIC_APP_URL ?? ""),
    authGoogle: raw.NEXT_PUBLIC_AUTH_GOOGLE?.trim().toLowerCase() === "on",
  };
}

let cached: PublicEnv | undefined;

/** The parsed public env, computed once per bundle. */
export function publicEnv(): PublicEnv {
  if (cached) return cached;
  cached = parsePublicEnv({
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_STREAM_URL: process.env.NEXT_PUBLIC_STREAM_URL,
    NEXT_PUBLIC_COLLAB_URL: process.env.NEXT_PUBLIC_COLLAB_URL,
    NEXT_PUBLIC_INGEST_URL: process.env.NEXT_PUBLIC_INGEST_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_INTEGRATIONS_MODE: process.env.NEXT_PUBLIC_INTEGRATIONS_MODE,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_AUTH_GOOGLE: process.env.NEXT_PUBLIC_AUTH_GOOGLE,
  });
  return cached;
}

/** Development/test only: the dev-auth bypass and the Simulate panel exist (docs/DECISIONS.md "Development auth bypass"). */
export function isDevLike(env: Pick<PublicEnv, "appEnv"> = publicEnv()): boolean {
  return env.appEnv === "development" || env.appEnv === "test";
}

/** Supabase Auth is configured; without it only the dev bypass can sign in. */
export function hasSupabase(env: Pick<PublicEnv, "supabaseUrl" | "supabaseAnonKey"> = publicEnv()): boolean {
  return env.supabaseUrl.length > 0 && env.supabaseAnonKey.length > 0;
}

/** "Continue with Google" is offered on the sign-in page (NEXT_PUBLIC_AUTH_GOOGLE=on). */
export function googleSignInEnabled(env: Pick<PublicEnv, "authGoogle"> = publicEnv()): boolean {
  return env.authGoogle;
}

/** The Simulate panel (BUILD §13.3) exists in development and staging only; it calls `dev.simulate` on apps/api, never ingest directly (SEC-2). */
export function simulatePanelAvailable(env: Pick<PublicEnv, "appEnv"> = publicEnv()): boolean {
  return env.appEnv === "development" || env.appEnv === "staging";
}

/** Test hook. */
export function resetPublicEnvCache(): void {
  cached = undefined;
}
