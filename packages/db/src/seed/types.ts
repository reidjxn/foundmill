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
