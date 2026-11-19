/**
 * WP-09 T14 step 1: every money number WP-09 added is a named, exported value in one config home: packages/config, the
 * shared constants, the env schema (as a default), or, for the session floor, apps/orchestrator's cycle contract. Never
 * a literal inside a function. The test reads the sources: each name is exported once, from its home, and nothing else
 * in the repository declares it again.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../../..");

/** Each money value, the file that owns it, and how it is declared there. */
const HOMES: { name: string; home: string; declared: RegExp }[] = [
  { name: "FIRST_CYCLE_SESSION_CAP_MINOR", home: "packages/config/src/pricing.ts", declared: /export const FIRST_CYCLE_SESSION_CAP_MINOR = \d+;/ },
  { name: "TOP_UP_OPTIONS_MINOR", home: "packages/config/src/pricing.ts", declared: /export const TOP_UP_OPTIONS_MINOR = \[[\d, ]+\] as const;/ },
  { name: "ENTRY_PLAN", home: "packages/config/src/pricing.ts", declared: /export const ENTRY_PLAN = \{[^}]*priceMonthlyMinor: \w+[^}]*\} as const( satisfies [^;]+)?;/ },
  { name: "CREDIT_PACKS_MINOR", home: "packages/config/src/pricing.ts", declared: /export const CREDIT_PACKS_MINOR = \[[\d, ]+\] as const;/ },
  { name: "CREDIT_PACK_CREDITS_MINOR", home: "packages/config/src/pricing.ts", declared: /export const CREDIT_PACK_CREDITS_MINOR: [^=]+= \{[\d:, ]+\};/ },
  // The two pre-commit ceilings: named defaults in the env schema, which an environment variable can change.
  { name: "PRECOMMIT_CEILING_DEFAULT_CENTS", home: "packages/shared/src/env.ts", declared: /export const PRECOMMIT_CEILING_DEFAULT_CENTS = \{ daily: \d+, monthly: \d+ \} as const;/ },
  { name: "OVERNIGHT_SHIFT", home: "packages/shared/src/autopilot.ts", declared: /export const OVERNIGHT_SHIFT = \{[^}]*ownSpendCeilingMinor: \d+[^}]*\} as const;/ },
  { name: "MIN_SESSION_CAP_MINOR", home: "apps/orchestrator/src/cycle-contract.ts", declared: /export const MIN_SESSION_CAP_MINOR = \d+;/ },
];

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".next" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec|stories)\.tsx?$/.test(entry) && !path.includes("__tests__")) out.push(path);
  }
  return out;
}

describe("WP-09's money numbers are config (T14)", () => {
  const files = [...sources(join(ROOT, "packages")), ...sources(join(ROOT, "apps"))].map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, "utf8") }));

  for (const { name, home, declared } of HOMES) {
    it(`${name} is exported once, from ${home}`, () => {
      const owner = files.find((f) => f.path === home);
      expect(owner?.text).toMatch(declared);
      const again = files.filter((f) => f.path !== home && new RegExp(`\\b(const|let|var)\\s+${name}\\b`).test(f.text)).map((f) => f.path);
      expect(again).toEqual([]);
    });
  }

  it("the env schema takes the pre-commit ceilings' defaults from their named value, not a literal", () => {
    const env = files.find((f) => f.path === "packages/shared/src/env.ts")!.text;
    expect(env).toMatch(/PRECOMMIT_DAILY_CEILING_CENTS: [^\n]*\.default\(PRECOMMIT_CEILING_DEFAULT_CENTS\.daily\)/);
    expect(env).toMatch(/PRECOMMIT_MONTHLY_CEILING_CENTS: [^\n]*\.default\(PRECOMMIT_CEILING_DEFAULT_CENTS\.monthly\)/);
  });
});
