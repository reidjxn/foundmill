/**
 * The dev bootstrap for a second account (docs/DECISIONS.md "Development auth bypass"; the Playwright stack's example
 * viewer, apps/web playwright.config.ts `E2E_EXAMPLE_VIEWER_ID`): when a `dev:<uuid>` bearer names an account the local
 * database has never seen, the api creates it as a stub `auth.users` row (no business, no profile), the way the seed
 * creates the demo founder, so the account can save a profile and open the example business like anyone signing up.
 *
 * Only where the stub auth schema is the auth schema: APP_ENV development or test, the dev bypass on
 * (DEV_AUTH_USER_ID), and a PGlite database. Anywhere else (staging, production, a local or hosted Supabase whose
 * auth.users belongs to Supabase Auth) it is off and returns undefined. Each account is ensured once per process.
 */
import { stubAuthProvisioner, type AuthProvisioner } from "@foundmill/db/seed";
import type { Db } from "@foundmill/db";

export interface DevUserBootstrapDeps {
  db: Db;
  env: { APP_ENV: string; DEV_AUTH_USER_ID?: string | null; DATABASE_URL?: string | null };
  /** Override the provisioner (tests). */
  auth?: AuthProvisioner;
}

/** True where a dev account may be created: development or test, the dev bypass on, the stub auth schema (PGlite). */
export function devUserBootstrapEnabled(env: DevUserBootstrapDeps["env"]): boolean {
  if (env.APP_ENV !== "development" && env.APP_ENV !== "test") return false;
  if (!env.DEV_AUTH_USER_ID) return false;
  return typeof env.DATABASE_URL === "string" && /^pglite:/i.test(env.DATABASE_URL);
}

/** The stub address a dev account gets: never a real inbox. */
export function devUserEmail(userId: string): string {
  return `dev-${userId.toLowerCase()}@foundmill.local`;
}

/** `onDevUser` for createAuthVerifier, or undefined where the bootstrap is off. */
export function createDevUserBootstrap(deps: DevUserBootstrapDeps): ((userId: string) => Promise<void>) | undefined {
  if (!devUserBootstrapEnabled(deps.env)) return undefined;
  const auth = deps.auth ?? stubAuthProvisioner(deps.db);
  const ensured = new Map<string, Promise<void>>();
  return (userId: string) => {
    const id = userId.toLowerCase();
    const known = ensured.get(id);
    if (known) return known;
    const run = auth.ensureUser(devUserEmail(id), { preferredId: id, displayName: "Dev account" }).then(
      () => undefined,
      (err: unknown) => {
        // Not remembered: the next request tries again.
        ensured.delete(id);
        throw err;
      },
    );
    ensured.set(id, run);
    return run;
  };
}
