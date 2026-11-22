/**
 * Booking setup, live (founder, Nov 22, 2026). Runs only with MODEL_MODE=live and a key (`pnpm evals`); skipped
 * otherwise. Gate: every case. The draft says what the founder said (services, minutes, prices, hours, zone), names no
 * booking vendor, and text a customer typed changes nothing.
 */
import { describe, expect, it } from "vitest";
import { BOOKING_SETUP_CASES, runBookingSetupCase } from "../booking/cases";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("the team drafts booking from the founder's own words (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "passes every case",
    async () => {
      const results = await runAll(BOOKING_SETUP_CASES, 3, (c) => runBookingSetupCase(client!, c));
      for (const r of results) if (!r.passed) console.warn(`[eval] booking setup ${r.caseId}: ${r.problems.join(", ")}`);
      console.warn(`[eval] booking setup: ${results.filter((r) => r.passed).length}/${results.length} passed, cost ${results.reduce((s, r) => s + r.costMinor, 0)} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    5 * 60 * 1000,
  );
});
