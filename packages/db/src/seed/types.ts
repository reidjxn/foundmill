/** Public types of the seed (`seedDemo(db, opts)`). */
import type { AuthProvisioner } from "./auth";

export interface SeedDemoOptions {
  /** PRNG root; the same seed, today and days produce the same content. Default DEMO_SEED. */
  seed?: string;
  /** The last day of the generated history. Default: now. */
  today?: Date;
  /** Days of history. Default 730. */
  days?: number;
  /** Multiplies every volume (signups, visitors, touches). Default 1; tests use a fraction for speed. */
  volumeScale?: number;
  /** Extra owner emails (SEED_OWNER_EMAILS); each gets an owner membership on both businesses. */
  ownerEmails?: string[];
  /** How auth users are created. Default: stub rows in `auth.users` (PGlite / local). */
  auth?: AuthProvisioner;
  /** Whether to refresh journey_daily_mv at the end (default true). */
  refreshDaily?: boolean;
  /**
   * Whether the demo owner gets a founder profile (default true). `false` (SEED_OWNER_PROFILE=0) leaves the demo owner
   * without one (and removes a profile an earlier seed created) so the AC-11.1.1 onboarding redirect can be exercised
   * with DEV_AUTH_USER_ID = the demo owner. Extra owners (SEED_OWNER_EMAILS) are not affected.
   */
  ownerProfile?: boolean;
  /**
   * Also build one real project owned by the demo founder (seed/e2e-project.ts): the browser suites' stand-in for a
   * project that is not a sample. `SEED_E2E_PROJECT=1`, read for a local PGlite directory only. Default off.
   */
  e2eProject?: boolean;
  log?: (message: string) => void;
}

export interface SeededBusiness {
  id: string;
  slug: string;
  name: string;
  departmentIds: string[];
  agentIds: string[];
  chiefOfStaffId: string;
  counts: Record<string, number>;
}

export interface SeedDemoResult {
  owner: { userId: string; email: string };
  owners: Array<{ userId: string; email: string }>;
  businesses: { northwind: SeededBusiness; ledgerly: SeededBusiness };
  platformSkillDefinitionsAdded: number;
  durationMs: number;
}
