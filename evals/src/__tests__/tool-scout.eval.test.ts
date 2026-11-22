/**
 * The tool scout, live (founder, Nov 22, 2026). Runs only with MODEL_MODE=live and a key (`pnpm evals`); skipped
 * otherwise. Gate: every case. A fintech project gets a cited identity-check pick with two alternatives and an
 * Estimate; a cleaning business gets Foundmill's own booking and no vendor; a project that has a tool, or said not now,
 * gets nothing; an instruction inside a vendor's page changes nothing.
 */
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { TOOL_SCOUT_CASES, runToolScoutCase } from "../tool-scout/cases";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("the tool scout recommends the right tool at the right time (live)", () => {
  const client = live ? createEvalClient() : null;

  it(
    "passes every case",
    async () => {
      const results = await runAll(TOOL_SCOUT_CASES, 3, (c) => runToolScoutCase(client!, c));
      for (const r of results) if (!r.passed) console.warn(`[eval] tool scout ${r.caseId}: ${r.problems.join(", ")}`);
      console.warn(`[eval] tool scout: ${results.filter((r) => r.passed).length}/${results.length} passed, cost ${results.reduce((s, r) => s + r.costMinor, 0)} minor (Estimate)`);
      expect(results.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    },
    5 * 60 * 1000,
  );
});
