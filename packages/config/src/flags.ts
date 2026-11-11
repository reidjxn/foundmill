/** Feature flags. Defaults are safe for staging in mock mode. */
export const FLAGS = {
  liveMode: false, // LIVE game mode surfaces (Phase 4)
  devSimulatePanel: true, // Settings → Integrations → Simulate (dev/staging only; see simulatePanelHonoured)
  holidayMode: true,
  trainingGround: true,
  matchDaySound: false,
} as const;
export type FlagKey = keyof typeof FLAGS;

/**
 * Whether the LIVE surfaces (the network, communities, going live) are open on this deployment. They are
 * closed while `FLAGS.liveMode` is false (DECISIONS 2026-10-07: the social layer is Phase 4); an operator opens them for
 * one environment with `LIVE_MODE=1` (the local stack and the demo do), and nothing else opens them.
 */
export function liveModeOpen(env: { LIVE_MODE?: string | undefined }, flag: boolean = FLAGS.liveMode): boolean {
  return flag || /^(1|true|yes|on)$/i.test((env.LIVE_MODE ?? "").trim());
}

/**
 * Simulate panel gate (docs/SECURITY_REVIEW.md SEC-2). `FLAGS.devSimulatePanel` alone never opens the route: it is
 * honoured only where `APP_ENV` is development or staging **and** the request carries a verified service token
 * minted by apps/api for the signed-in owner/admin. Production never honours it, whatever the flag says.
 */
export const SIMULATE_ENVS = ["development", "staging"] as const;
export type SimulateEnv = (typeof SIMULATE_ENVS)[number];

/** JWT audience of the service token apps/api mints and apps/ingest verifies (HS256 with SESSION_TOKEN_SECRET). */
export const SIMULATE_TOKEN_AUDIENCE = "foundmill-ingest/simulate";
/** Issuer of that token. */
export const SIMULATE_TOKEN_ISSUER = "foundmill-api";
/** Hard ceiling on a simulate token's lifetime (`exp - iat`); longer tokens are refused. */
export const SIMULATE_TOKEN_MAX_TTL_SECONDS = 5 * 60;
/** What apps/api mints by default: one request's worth. */
export const SIMULATE_TOKEN_DEFAULT_TTL_SECONDS = 60;

/** Whether `appEnv` may host the Simulate routes at all (the flag being on is still required). */
export const isSimulateEnv = (appEnv: string): appEnv is SimulateEnv => (SIMULATE_ENVS as readonly string[]).includes(appEnv);

export interface SimulateGate {
  appEnv: string;
  /** `FLAGS.devSimulatePanel` (injectable for tests). */
  flag?: boolean;
  /** The request carried a service token that verified (audience, signature, expiry, businessId). */
  serviceTokenVerified: boolean;
}

/** The only predicate that may let a simulation run: flag on, development/staging, verified service token. */
export function simulatePanelHonoured({ appEnv, flag = FLAGS.devSimulatePanel, serviceTokenVerified }: SimulateGate): boolean {
  if (appEnv === "production") return false;
  return flag && isSimulateEnv(appEnv) && serviceTokenVerified === true;
}
