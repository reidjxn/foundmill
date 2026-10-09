/**
 * Fixed identifiers for the demo seed (BUILD §17.2). Business ids and the stub owner id are constants so e2e specs,
 * Storybook fixtures and the dev-auth bypass can point at them; everything else is derived from the seeded PRNG.
 */

/** Root of every PRNG stream; bump when the generated content must change shape. */
export const DEMO_SEED = "foundmill-demo-v1";

/** The demo founder (stub auth user on PGlite / local; created through the admin API on Supabase). */
export const DEMO_OWNER_EMAIL = "demo-founder@foundmill.local";
export const DEMO_OWNER_USER_ID = "0f0a0d00-0000-4000-8000-00000000f0a1";
export const DEMO_OWNER_DISPLAY_NAME = "Jamie Reyes";

export const NORTHWIND_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000001";
export const NORTHWIND_SLUG = "northwind-skincare";
export const NORTHWIND_NAME = "Northwind Skincare";

export const LEDGERLY_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000002";
export const LEDGERLY_SLUG = "ledgerly";
export const LEDGERLY_NAME = "Ledgerly";

export const DEMO_BUSINESS_SLUGS = [NORTHWIND_SLUG, LEDGERLY_SLUG] as const;

export const LEDGERLY_COMMUNITY_SLUG = "fintech-ops-founders";
/** A public community with no members yet, so the demo founder sees Join on offer. */
export const BOOTSTRAPPED_COMMUNITY_SLUG = "bootstrapped-founders";
/** Every community the demo seed creates; a rebuild deletes them all (posts and members cascade). */
export const SEED_COMMUNITY_SLUGS = [LEDGERLY_COMMUNITY_SLUG, BOOTSTRAPPED_COMMUNITY_SLUG] as const;
export const LEDGERLY_GITHUB_REPO = "foundmill-demo/ledgerly";

/** Two years of history by default (AC-11.2.1). */
export const DEFAULT_SEED_DAYS = 730;
